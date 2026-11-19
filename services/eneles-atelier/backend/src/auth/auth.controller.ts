import { maskEmail } from '../common/utils/mask-email';
import {
  Body,
  Controller,
  Delete,
  Post,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Inject,
  forwardRef,
  Headers,
  Req,
  Res,
  Query,
  ForbiddenException,
} from '@nestjs/common';
import { Request, Response } from 'express';
import {
  clearSessionCookie,
  cookieRequestAllowed,
  setSessionCookie,
  tokenFromHeaders,
} from '../common/session-cookie';
import { randomInt, timingSafeEqual } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { AuditService } from '../audit/audit.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RedisService } from '../common/redis';
import {
  LoginDto,
  SignupDto,
  VerifyLoginDto,
  Verify2FADto,
  SendOtpDto,
} from './dto';
import { PaginationQueryDto } from '../common/dto/pagination.dto';
import { isAllowedOrigin } from '../common/cors';

interface PendingSignup {
  email: string;
  name: string;
  otp: string;
  expiresAt: Date;
  createdAt: Date;
  attempts: number; // failed OTP attempts for this pending signup
  deletedUserId?: number;
}

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  // In-memory store for pending signups. Key is a temporary negative ID.
  // NOTHING goes into the DB until OTP is verified.
  private pendingSignupsFallback = new Map<number, PendingSignup>();

  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    @Inject(forwardRef(() => UsersService))
    private readonly usersService: UsersService,
    private readonly redisService: RedisService,
  ) {
    const cleanupTimer = setInterval(() => this.cleanupStalePendingSignups(), 10 * 60 * 1000);
    // Do not keep short-lived test processes alive solely for this maintenance task.
    cleanupTimer.unref?.();
  }

  // ─── Pending Signup Redis Helpers ─────────────────────────────

  private async getPendingSignup(id: number): Promise<PendingSignup | null> {
    if (this.redisService.isConnected) {
      return this.redisService.getJson<PendingSignup>(`pending:signup:${id}`);
    }
    return this.pendingSignupsFallback.get(id) ?? null;
  }

  /**
   * A fresh negative id for a pending signup. Random rather than a per-process counter: a counter restarts at -1 on every deploy or restart and is shared by nothing across instances, so two signups could get the same id and the second would overwrite the first's pending entry.
   */
  private async newPendingId(): Promise<number> {
    for (;;) {
      const id = -randomInt(1, 2 ** 31 - 1);
      const taken = this.redisService.isConnected
        ? (await this.redisService.get(`pending:signup:${id}`)) !== null
        : this.pendingSignupsFallback.has(id);
      if (!taken) return id;
    }
  }

  private async setPendingSignup(
    id: number,
    data: PendingSignup,
  ): Promise<void> {
    if (this.redisService.isConnected) {
      await this.redisService.setJson(`pending:signup:${id}`, data, 15 * 60); // 15 min TTL
    } else {
      this.pendingSignupsFallback.set(id, data);
    }
  }

  private async deletePendingSignup(id: number): Promise<void> {
    if (this.redisService.isConnected) {
      await this.redisService.del(`pending:signup:${id}`);
    } else {
      this.pendingSignupsFallback.delete(id);
    }
  }

  private async updatePendingSignupAttempts(
    id: number,
    pending: PendingSignup,
  ): Promise<void> {
    await this.setPendingSignup(id, pending);
  }

  /**
   * Finish a sign-in. The browser gets the HttpOnly session cookie. The token
   * also goes back in the body, but only to callers that are not web pages
   * (no Origin header), such as scripts using the API directly; the site
   * never sees it.
   */
  /**
   * The error a person sees. Our own HTTP errors (a wrong code, a throttle)
   * pass through; anything else, such as a database failure, is logged and
   * replaced, so internal messages never reach the browser.
   */
  private publicError(
    error: unknown,
    fallback: string,
    status: HttpStatus,
  ): HttpException {
    if (error instanceof HttpException) return error;
    this.logger.error(
      `${fallback}: ${error instanceof Error ? error.message : String(error)}`,
    );
    void status;
    return new HttpException(
      'Something went wrong on our side. Try again in a moment.',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }

  private signedIn(user: any, token: string, req: Request, res: Response) {
    setSessionCookie(res, token);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password, twoFactorSecret, ...safeUser } = (user ?? {}) as any;
    return req.headers.origin ? safeUser : { ...safeUser, token };
  }

  // ─── Identity resolution ────────────────────────────────────────

  /**
   * Turn a verification request's identity into a user id.
   *
   * Login requests carry an email, because `POST /auth/login` no longer tells
   * the client the user's id. Signup requests carry a negative pending id. A
   * lookup that finds nothing raises the same "invalid code" error a wrong
   * code would, so the verify endpoints cannot be used to test whether an
   * address is registered either.
   */
  private async resolveVerificationUserId(identity: {
    userId?: number;
    email?: string;
  }): Promise<number> {
    if (typeof identity.userId === 'number') return identity.userId;

    const user = identity.email
      ? await this.usersService.findByEmail(identity.email)
      : null;

    if (!user || (user as any).accountStatus === 'deleted') {
      throw new HttpException(
        'Invalid or expired verification code',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return user.id;
  }

  // ─── LOGIN (existing users only) ───────────────────────────────

  /**
   * Start a login by emailing a one-time code.
   *
   * The response is identical whether or not an account exists for the
   * address. Previously this returned 404 for unknown emails, 403 for deleted
   * accounts and the user's id on success, which made it a free lookup for
   * "does this person have an account here". Now the only way to learn that
   * is to control the inbox.
   *
   * The response TIME is also held constant. The registered path writes an
   * OTP row and dispatches an email; the unregistered path does neither, and
   * without a floor the gap is measurable. Both paths wait until the same
   * minimum has elapsed. Email delivery itself is not awaited (see
   * AuthService.sendVerificationOTP), so the floor only needs to cover the
   * database work.
   */
  @Public()
  @Post('login')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async login(@Body() loginDto: LoginDto, @Req() req: Request) {
    const startedAt = Date.now();
    const ip =
      req.ip ||
      undefined;
    const ua = (req.headers['user-agent'] as string) || undefined;

    const uniform = {
      email: loginDto.email,
      message:
        'If an account exists for this address, a verification code has been sent.',
    };

    const user = await this.usersService.findByEmail(loginDto.email);

    if (!user || (user as any).accountStatus === 'deleted') {
      // Logged for our benefit, invisible to the caller.
      this.auditService.logAuth('login.fail', {
        userId: user?.id,
        outcome: 'failure',
        ipAddress: ip,
        userAgent: ua,
        metadata: { reason: user ? 'account_deleted' : 'user_not_found' },
      });
      await this.padToMinimum(startedAt);
      return uniform;
    }

    const otpSent = await this.authService.sendVerificationOTP(user.id);
    if (!otpSent) {
      // A delivery failure is ours, not the caller's, and saying so does not
      // reveal anything about the account: the same 500 would occur for any
      // address if the mail provider were down.
      this.logger.error(`Failed to send login OTP to user ${user.id}`);
      throw new HttpException(
        'Failed to send verification code',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    this.auditService.logAuth('login.otp_sent', {
      userId: user.id,
      outcome: 'success',
      ipAddress: ip,
      userAgent: ua,
    });

    await this.padToMinimum(startedAt);
    return uniform;
  }

  /**
   * Hold a response until at least LOGIN_MIN_MS have passed since `startedAt`.
   * 250ms comfortably exceeds the two database round-trips the registered
   * path performs, and is imperceptible against network latency.
   */
  private static readonly LOGIN_MIN_MS = 250;

  private async padToMinimum(startedAt: number): Promise<void> {
    const remaining = AuthController.LOGIN_MIN_MS - (Date.now() - startedAt);
    if (remaining > 0) {
      await new Promise((resolve) => setTimeout(resolve, remaining));
    }
  }

  // ─── SIGNUP (new users, nothing in DB until OTP verified) ─────

  @Public()
  @Post('signup')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async signup(@Body() signupDto: SignupDto, @Req() req: Request) {
    const startedAt = Date.now();
    const ip =
      req.ip ||
      undefined;
    const ua = (req.headers['user-agent'] as string) || undefined;
    try {
      this.logger.log(`Signup request for ${maskEmail(signupDto.email)}`);

      const existingUser = await this.usersService.findByEmail(signupDto.email);
      if (existingUser && (existingUser as any).accountStatus !== 'deleted') {
        // The address already has an account. Saying so would make signup an
        // account-existence oracle, undoing the point of the uniform login
        // response. Instead, send the existing account a login code and return
        // the same shape a fresh signup would. Whoever owns the inbox ends up
        // signed in; everyone else learns nothing.
        this.auditService.logAuth('signup.initiated', {
          userId: existingUser.id,
          outcome: 'success',
          ipAddress: ip,
          userAgent: ua,
          metadata: { reason: 'email_exists_sent_login_code' },
        });

        const sent = await this.authService.sendVerificationOTP(
          existingUser.id,
        );
        if (!sent) {
          throw new HttpException(
            'Failed to send verification code',
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }

        // Verification for an existing account is keyed by email, not by the
        // negative pending id a real signup returns. The client treats both
        // identically: show the code modal, verify against verify-login.
        await this.padToMinimum(startedAt);
        return {
          email: signupDto.email,
          message: 'Verification code sent to your email',
        };
      }

      // Clean up any existing pending signup for this email
      // For in-memory fallback, iterate the map; for Redis, we just overwrite with a new key
      if (!this.redisService.isConnected) {
        for (const [id, pending] of this.pendingSignupsFallback.entries()) {
          if (pending.email === signupDto.email) {
            this.pendingSignupsFallback.delete(id);
          }
        }
      }

      const otp = this.authService.generateOTPCode();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + 10);

      const pendingId = await this.newPendingId();
      await this.setPendingSignup(pendingId, {
        email: signupDto.email,
        name: signupDto.name || signupDto.email.split('@')[0],
        otp,
        expiresAt,
        createdAt: new Date(),
        attempts: 0,
        deletedUserId: existingUser ? existingUser.id : undefined,
      });

      // Dispatch without awaiting delivery, matching the existing-account
      // branch above. If this branch waited on the mail provider and that one
      // did not, response time alone would say which branch ran.
      void this.authService
        .sendOTPEmail(signupDto.email, otp)
        .then((sent) => {
          if (!sent) {
            this.logger.error(
              `Signup OTP email failed for pending ${pendingId}; clearing pending signup`,
            );
            void this.deletePendingSignup(pendingId);
          }
        })
        .catch((err: unknown) => {
          this.logger.error(
            `Signup OTP email error for pending ${pendingId}: ${err instanceof Error ? err.message : String(err)}`,
          );
          void this.deletePendingSignup(pendingId);
        });

      this.auditService.logAuth('signup.initiated', {
        outcome: 'success',
        ipAddress: ip,
        userAgent: ua,
        metadata: { email: signupDto.email },
      });

      await this.padToMinimum(startedAt);
      return {
        userId: pendingId,
        email: signupDto.email,
        message: 'Verification code sent to your email',
      };
    } catch (error) {
      this.logger.error(`Signup error: ${error.message}`);
      throw this.publicError(error, 'Signup failed', HttpStatus.BAD_REQUEST);
    }
  }

  // ─── VERIFY LOGIN / SIGNUP OTP ────────────────────────────────

  @Public()
  @Post('verify-login')
  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10 verification attempts per minute
  async verifyLogin(
    @Body() body: VerifyLoginDto,
    @Headers('user-agent') userAgent: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const { code } = body;
      const userId = await this.resolveVerificationUserId(body);

      const ipAddress =
        req.ip ||
        undefined;

      // ── SIGNUP flow (negative userId = pending signup) ──
      if (userId < 0) {
        this.logger.log(`Verifying signup OTP for pendingId: ${userId}`);

        const pending = await this.getPendingSignup(userId);
        if (!pending) {
          throw new HttpException(
            'Signup session expired. Please sign up again.',
            HttpStatus.BAD_REQUEST,
          );
        }

        // Check expiry
        if (new Date() > new Date(pending.expiresAt)) {
          await this.deletePendingSignup(userId);
          throw new HttpException(
            'Verification code expired. Please sign up again.',
            HttpStatus.BAD_REQUEST,
          );
        }

        // Brute-force guard for pending signups (max 5 attempts)
        if (pending.attempts >= 5) {
          await this.deletePendingSignup(userId);
          throw new HttpException(
            'Too many incorrect attempts. Please sign up again to get a new code.',
            HttpStatus.TOO_MANY_REQUESTS,
          );
        }

        // Timing-safe comparison to prevent enumeration via timing attack
        const expected = Buffer.from(pending.otp);
        const received = Buffer.from(
          code.length === pending.otp.length
            ? code
            : '\0'.repeat(pending.otp.length),
        );
        const match =
          expected.length === received.length &&
          timingSafeEqual(expected, received) &&
          code === pending.otp;

        if (!match) {
          pending.attempts += 1;
          await this.updatePendingSignupAttempts(userId, pending);
          throw new HttpException(
            'Invalid verification code',
            HttpStatus.BAD_REQUEST,
          );
        }

        // OTP valid, create/reset user
        this.logger.log(
          `OTP verified for signup. Creating/resetting user: ${pending.email}`,
        );

        let newUser;
        if (pending.deletedUserId) {
          this.logger.log(
            `Re-signup: wiping data for deleted user ${pending.deletedUserId}`,
          );
          newUser = await this.usersService.wipeAndReset(
            pending.deletedUserId,
            pending.name,
          );
        } else {
          newUser = await this.usersService.create({
            email: pending.email,
            name: pending.name,
            verified: true,
          });
        }

        await this.deletePendingSignup(userId);

        const { user, token } = await this.authService.completeLogin(
          newUser.id,
          userAgent,
          ipAddress,
        );

        this.auditService.logAuth('signup.success', {
          userId: newUser.id,
          outcome: 'success',
          ipAddress,
          userAgent,
        });

        return this.signedIn(user, token, req, res);
      }

      // ── LOGIN flow (positive userId = existing user) ──
      this.logger.log(`Verifying login OTP for userId: ${userId}`);

      const isValid = await this.authService.verifyOTP(userId, code);

      if (!isValid) {
        this.auditService.logAuth('otp.fail', {
          userId,
          outcome: 'failure',
          ipAddress,
          userAgent,
        });
        throw new HttpException(
          'Invalid or expired verification code',
          HttpStatus.BAD_REQUEST,
        );
      }

      const userFor2FA = await this.usersService.findOne(userId);

      if (userFor2FA && userFor2FA.twoFactorEnabled) {
        return {
          userId: userFor2FA.id,
          requires2FA: true,
          message: 'Please enter the code from your authenticator app',
        };
      }

      const { user, token } = await this.authService.completeLogin(
        userId,
        userAgent,
        ipAddress,
      );

      this.auditService.logAuth('login.success', {
        userId,
        outcome: 'success',
        ipAddress,
        userAgent,
      });

      return this.signedIn(user, token, req, res);
    } catch (error) {
      if (error.status !== 429) {
        // don't double-log throttle errors
        this.logger.error(`Verification error: ${error.message}`);
      }
      throw this.publicError(
        error,
        'Verification failed',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  // ─── VERIFY APP 2FA (TOTP) ───────────────────────────────────

  @Public()
  @Post('verify-2fa')
  @Throttle({ default: { ttl: 60000, limit: 10 } }) // 10 2FA attempts per minute
  async verifyApp2FA(
    @Body() body: Verify2FADto,
    @Headers('user-agent') userAgent: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    try {
      const { code } = body;
      const userId = await this.resolveVerificationUserId(body);
      const ipAddress =
        req.ip ||
        undefined;

      const isValid = await this.authService.verifyApp2FA(userId, code);

      if (!isValid) {
        throw new HttpException(
          'Invalid authentication code',
          HttpStatus.UNAUTHORIZED,
        );
      }

      const { user, token } = await this.authService.completeLogin(
        userId,
        userAgent,
        ipAddress,
      );

      return this.signedIn(user, token, req, res);
    } catch (error) {
      throw this.publicError(
        error,
        'Verification failed',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  // ─── RESEND OTP ───────────────────────────────────────────────

  @Public()
  @Post('send-otp')
  @Throttle({ default: { ttl: 60000, limit: 3 } }) // 3 resend attempts per minute
  async sendOTP(@Body() body: SendOtpDto) {
    const startedAt = Date.now();
    // Same shape for every outcome, for the same reason as /auth/login: a
    // resend endpoint that says "no such user" is an enumeration oracle.
    const uniform = {
      message:
        'If an account exists for this address, a verification code has been sent.',
    };

    try {
      let userId: number;
      if (typeof body.userId === 'number') {
        userId = body.userId;
      } else {
        const user = body.email
          ? await this.usersService.findByEmail(body.email)
          : null;
        if (!user || (user as any).accountStatus === 'deleted') {
          await this.padToMinimum(startedAt);
          return uniform;
        }
        userId = user.id;
      }

      // Pending signup (negative ID)
      if (userId < 0) {
        const pending = await this.getPendingSignup(userId);
        if (!pending) {
          throw new HttpException(
            'Signup session expired. Please sign up again.',
            HttpStatus.BAD_REQUEST,
          );
        }

        // Generate a new OTP
        const otp = this.authService.generateOTPCode();
        const expiresAt = new Date();
        expiresAt.setMinutes(expiresAt.getMinutes() + 10);
        pending.otp = otp;
        pending.expiresAt = expiresAt;

        await this.setPendingSignup(userId, pending);

        const emailSent = await this.authService.sendOTPEmail(
          pending.email,
          otp,
        );

        if (!emailSent) {
          throw new HttpException(
            'Failed to send OTP',
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        }

        return { message: 'OTP sent successfully' };
      }

      // Existing user (positive ID)
      const success = await this.authService.sendVerificationOTP(userId);

      if (!success) {
        throw new HttpException(
          'Failed to send OTP',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      await this.padToMinimum(startedAt);
      return uniform;
    } catch (error) {
      throw this.publicError(
        error,
        'Failed to send OTP',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // The standalone POST /auth/verify-otp route was removed. It verified a code
  // without issuing a token, so nothing could complete a login through it, and
  // it had drifted from the real verification path: a plain !== comparison
  // instead of the timing-safe one, no failed-attempt counter, and it accepted
  // a positive userId, which made it an account-existence oracle. Everything
  // it did, verify-login does properly.

  /**
   * Exchange a verified Eneles/Supabase session for this editor's own
   * revocable session. The email and user id are read only from Supabase's
   * verified /auth/v1/user response, never from the browser payload.
   */
  @Public()
  @Post('eneles-sso')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async enelesSso(
    @Body() body: { accessToken?: string },
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Headers('user-agent') userAgent: string,
  ) {
    const accessToken = typeof body?.accessToken === 'string' ? body.accessToken : '';
    if (accessToken.length < 80 || accessToken.length > 8192) {
      throw new HttpException('Session Eneles invalide.', HttpStatus.UNAUTHORIZED);
    }
    if (req.headers.origin && !isAllowedOrigin(req.headers.origin)) {
      throw new ForbiddenException('Origine non autorisée.');
    }

    const supabaseUrl = (this.configService.get<string>('ENELES_SUPABASE_URL') || '').replace(/\/$/, '');
    const supabaseAnonKey = this.configService.get<string>('ENELES_SUPABASE_ANON_KEY') || '';
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new HttpException('Connexion Eneles non configurée sur le serveur.', HttpStatus.SERVICE_UNAVAILABLE);
    }

    let identity: any;
    try {
      const verified = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!verified.ok) throw new Error(`Supabase returned ${verified.status}`);
      identity = await verified.json();
    } catch (error) {
      this.logger.warn(`Eneles SSO verification failed: ${error instanceof Error ? error.message : String(error)}`);
      throw new HttpException('La session Google Eneles a expiré ou ne peut pas être vérifiée.', HttpStatus.UNAUTHORIZED);
    }

    const supabaseUserId = typeof identity?.id === 'string' ? identity.id : '';
    const email = typeof identity?.email === 'string' ? identity.email.trim().toLowerCase() : '';
    const emailVerified = !!(identity?.email_confirmed_at || identity?.confirmed_at);
    if (!supabaseUserId || !email.includes('@') || !emailVerified) {
      throw new HttpException('Le compte Eneles doit posséder une adresse confirmée.', HttpStatus.FORBIDDEN);
    }

    const metadata = identity?.user_metadata || {};
    const displayName = String(metadata.full_name || metadata.name || email.split('@')[0]).trim().slice(0, 100);
    let account = await this.usersService.findBySupabaseUserId(supabaseUserId);
    const byEmail = await this.usersService.findByEmail(email);

    if (account && byEmail && account.id !== byEmail.id) {
      throw new HttpException('Cette adresse est déjà associée à un autre compte de l’atelier.', HttpStatus.CONFLICT);
    }
    if (!account && byEmail) {
      if ((byEmail as any).accountStatus === 'deleted') {
        throw new ForbiddenException('Ce compte de l’atelier a été fermé.');
      }
      if (byEmail.supabaseUserId && byEmail.supabaseUserId !== supabaseUserId) {
        throw new HttpException('Ce compte est déjà lié à une autre identité Eneles.', HttpStatus.CONFLICT);
      }
      account = await this.usersService.update(byEmail.id, {
        supabaseUserId, verified: true,
        ...(byEmail.email !== email ? { email } : {}),
        ...(!byEmail.name ? { name: displayName } : {}),
      });
    } else if (!account) {
      account = await this.usersService.create({
        email, name: displayName, verified: true, supabaseUserId,
      });
    } else if (account.email !== email) {
      account = await this.usersService.update(account.id, { email, verified: true });
    }

    if ((account as any).accountStatus === 'deleted') {
      throw new ForbiddenException('Ce compte de l’atelier a été fermé.');
    }
    const { user, token } = await this.authService.completeLogin(
      account.id, userAgent, req.ip || undefined,
    );
    setSessionCookie(res, token);
    const { password, twoFactorSecret, ...safeUser } = (user ?? {}) as any;
    this.auditService.logAuth('login.success', {
      userId: account.id, outcome: 'success', ipAddress: req.ip || undefined,
      userAgent, metadata: { provider: 'eneles-supabase-sso' },
    });
    return { user: safeUser, token };
  }

  // ─── LOGOUT ───────────────────────────────────────────────────

  /**
   * Public, so it can always clear the cookie: an expired session would
   * otherwise fail the guard and leave a cookie the page cannot remove.
   */
  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const source = tokenFromHeaders(req.headers);
    if (
      source?.via === 'cookie' &&
      !cookieRequestAllowed(req.method, req.headers)
    ) {
      throw new ForbiddenException('This request did not come from Eneles');
    }
    clearSessionCookie(res);
    if (source) {
      try {
        const payload = await this.authService.validateToken(source.token);
        if (payload.sid) await this.authService.deactivateSession(payload.sid);
      } catch {
        // Already invalid: nothing to end.
      }
    }
    return { message: 'Logged out' };
  }

  /**
   * Older versions of the site kept the token in localStorage. On its first
   * load the new site sends that token here once, as a Bearer header, and
   * from then on uses the HttpOnly cookie instead.
   */
  @Post('session')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  adoptSession(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const source = tokenFromHeaders(req.headers);
    if (source?.via !== 'header') {
      throw new HttpException(
        'Send the token as a Bearer header',
        HttpStatus.BAD_REQUEST,
      );
    }
    setSessionCookie(res, source.token);
    return { ok: true };
  }

  // ─── ACTIVE SESSIONS ─────────────────────────────────────────

  @Get('sessions')
  async getSessions(
    @CurrentUser() userId: number,
    @Query() query: PaginationQueryDto,
  ) {
    try {
      return this.authService.getActiveSessionsPaginated(userId, {
        page: query.page ?? 1,
        limit: query.limit ?? 20,
        sort: query.sort ?? 'lastActive',
        order: query.order ?? 'desc',
      });
    } catch (error) {
      throw this.publicError(
        error,
        'Failed to get sessions',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  @Delete('sessions')
  @HttpCode(HttpStatus.OK)
  async revokeAllSessions(
    @CurrentUser() userId: number,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.authService.deactivateAllSessions(userId);
    clearSessionCookie(res);
    return { message: 'All sessions revoked' };
  }

  // ─── CLEANUP ──────────────────────────────────────────────────

  private cleanupStalePendingSignups() {
    if (this.redisService.isConnected) return; // Redis TTL handles cleanup
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    let cleaned = 0;
    for (const [id, pending] of this.pendingSignupsFallback.entries()) {
      if (pending.createdAt < cutoff) {
        this.pendingSignupsFallback.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0)
      this.logger.log(`Cleaned up ${cleaned} stale pending signup(s)`);
  }
}
