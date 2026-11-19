import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { IsEmail, MaxLength } from 'class-validator';
import type { Request } from 'express';
import { AuditService } from '../audit/audit.service';
import { AuthService } from '../auth/auth.service';
import { Public } from '../common/decorators/public.decorator';
import { RedisService } from '../common/redis';
import { PrismaService } from '../prisma/prisma.service';
import { RootAdmin } from './root-admin';

class AdminCodeDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(254, { message: 'That email address is too long.' })
  email!: string;
}

/**
 * How often the panel sends codes:
 *
 * - `network`: code requests from one IP address in an hour. Past it, the address is refused with 429 for the rest of the hour.
 * - `cooldown`: one code to a mailbox per minute.
 * - `mailbox`: codes to one mailbox in an hour.
 *
 * The mailbox limits are silent (the answer is the same as when a code goes out), so they do not reveal which addresses are administrators. Codes already sent stay valid, and guessing one is limited separately (AuthService.verifyOTP locks the account after repeated wrong codes).
 */
export const ADMIN_CODE_LIMITS = {
  network: { max: 10, seconds: 60 * 60 },
  cooldown: { seconds: 60 },
  mailbox: { max: 5, seconds: 60 * 60 },
};

/** Every answer takes at least this long, so the time does not tell an administrator's address from anyone else's. */
const MIN_ANSWER_MS = 400;

/**
 * The panel's sign-in: an email address, then the six-digit code sent to it, checked by the site's own `POST /auth/verify-login` (and `POST /auth/verify-2fa` for an account with an authenticator). There are no passwords.
 *
 * A code goes only to an administrator: the root account (ADMIN_EMAIL) or an active, verified account whose administrator flag is on. Anyone else gets the same answer and no email, so the page cannot be used to send codes to people. Requests are limited per IP address and per mailbox (ADMIN_CODE_LIMITS) on top of a few a minute, and every request is written to the audit log.
 */
@Controller('admin')
export class AdminAuthController {
  /** Counters for when Redis is not connected (one process only). */
  private readonly local = new Map<string, { count: number; until: number }>();

  constructor(
    private readonly root: RootAdmin,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 3 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async requestCode(@Body() body: AdminCodeDto, @Req() req: Request) {
    const startedAt = Date.now();
    const email = body.email.trim().toLowerCase();
    const ip = req.ip || 'unknown';
    const userAgent = req.headers['user-agent'];
    const uniform = {
      email,
      message:
        'If this address belongs to an administrator, a sign-in code is on its way.',
    };
    const log = (
      outcome: 'success' | 'failure',
      reason: string,
      userId?: number,
    ) =>
      void this.audit.log({
        userId,
        action: 'admin.login',
        resource: 'auth',
        outcome,
        ipAddress: ip,
        userAgent,
        metadata: { step: 'code', reason },
      });

    const { network, cooldown, mailbox } = ADMIN_CODE_LIMITS;
    if (
      (await this.hit(`admin:code:ip:${ip}`, network.seconds)) > network.max
    ) {
      log('failure', 'network_limit');
      throw new HttpException(
        'Too many sign-in attempts from this network. Try again in an hour.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const account = await this.administrator(email);
    if (!account) {
      log('failure', 'not_admin');
      await this.pad(startedAt);
      return uniform;
    }

    const cooling =
      (await this.hit(`admin:code:wait:${email}`, cooldown.seconds)) > 1;
    const sent =
      (await this.hit(`admin:code:mail:${email}`, mailbox.seconds)) >
      mailbox.max;
    if (cooling || sent) {
      log('failure', cooling ? 'cooldown' : 'mailbox_limit', account.id);
      await this.pad(startedAt);
      return uniform;
    }

    if (!(await this.auth.sendVerificationOTP(account.id, { admin: true }))) {
      throw new HttpException(
        'The code could not be sent. Try again in a minute.',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
    log('success', 'code_sent', account.id);
    await this.pad(startedAt);
    return uniform;
  }

  /** The administrator with this address, or null: the root account (made on first use), or an active, verified account with the flag on. */
  private async administrator(email: string): Promise<{ id: number } | null> {
    if (this.root.isRoot(email)) return this.root.account();
    const user = await this.prisma.client.user.findUnique({
      where: { email },
      select: { id: true, isAdmin: true, verified: true, accountStatus: true },
    });
    return user?.isAdmin && user.verified && user.accountStatus === 'active'
      ? user
      : null;
  }

  /** Counts one more within a window that starts at the first count; returns the count so far. */
  private async hit(key: string, seconds: number): Promise<number> {
    if (this.redis.isConnected) {
      const count = await this.redis.incr(key);
      if (count === 1) await this.redis.expire(key, seconds);
      return count;
    }
    const now = Date.now();
    const entry = this.local.get(key);
    const next =
      entry && entry.until > now
        ? { count: entry.count + 1, until: entry.until }
        : { count: 1, until: now + seconds * 1000 };
    this.local.set(key, next);
    if (this.local.size > 10_000)
      for (const [k, v] of this.local) if (v.until <= now) this.local.delete(k);
    return next.count;
  }

  private async pad(startedAt: number): Promise<void> {
    const left = MIN_ANSWER_MS - (Date.now() - startedAt);
    if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
  }
}
