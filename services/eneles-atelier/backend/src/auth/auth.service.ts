import { countryOf } from '../common/geo/country';
import { maskEmail } from '../common/utils/mask-email';
import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  forwardRef,
} from '@nestjs/common';
import * as speakeasy from 'speakeasy';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../common/redis';

/** What a disabled account is told when it tries to sign in or use a session. Only someone who has just proved they own the inbox, or holds a session, ever sees it. */
export const SUSPENDED_MESSAGE = 'This account has been disabled by an administrator. Write to contact@eneles.example if you think this is a mistake.';

// Define JWT payload interface
export interface JwtPayload {
  sub: number; // User ID
  email: string;
  name?: string;
  sid?: string; // Session token
  iat?: number; // Issued at
  exp?: number; // Expiration time
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly OTP_EXPIRY_MINUTES = 10;
  private readonly SESSION_DURATION_DAYS = 7;
  /** How stale `lastActive` may get before a request refreshes it (and pushes the expiry out). Five minutes keeps "last active" honest at one small write per session per five minutes. */
  private readonly SESSION_EXTEND_THRESHOLD_HOURS = 5 / 60;
  private readonly SESSION_CACHE_TTL_MS = 60_000;

  // ─── OTP Brute-Force Protection ───────────────────────────────────────
  // Keyed by userId. Resets on successful verification or new OTP send.
  private readonly OTP_MAX_ATTEMPTS = 5;
  private readonly OTP_LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes
  // In-memory fallback (used when Redis is unavailable)
  private otpAttemptsFallback = new Map<
    number,
    { count: number; lockedUntil: number }
  >();

  // In-memory session cache fallback to avoid hitting DB on every request
  private sessionCacheFallback = new Map<
    string,
    { userId: number; session: any; cachedAt: number }
  >();

  constructor(
    private prisma: PrismaService,
    private emailService: EmailService,
    private jwtService: JwtService,
    @Inject(forwardRef(() => UsersService)) private usersService: UsersService,
    private redisService: RedisService,
  ) {}

  // ─── OTP Attempts Redis Helpers ───────────────────────────────────────

  private async getOtpAttempts(
    userId: number,
  ): Promise<{ count: number; lockedUntil: number }> {
    if (this.redisService.isConnected) {
      const data = await this.redisService.getJson<{
        count: number;
        lockedUntil: number;
      }>(`otp:attempts:${userId}`);
      return data ?? { count: 0, lockedUntil: 0 };
    }
    return this.otpAttemptsFallback.get(userId) ?? { count: 0, lockedUntil: 0 };
  }

  private async setOtpAttempts(
    userId: number,
    data: { count: number; lockedUntil: number },
  ): Promise<void> {
    if (this.redisService.isConnected) {
      // TTL: lockout duration + 5 min buffer
      await this.redisService.setJson(`otp:attempts:${userId}`, data, 20 * 60);
    } else {
      this.otpAttemptsFallback.set(userId, data);
    }
  }

  private async deleteOtpAttempts(userId: number): Promise<void> {
    if (this.redisService.isConnected) {
      await this.redisService.del(`otp:attempts:${userId}`);
    } else {
      this.otpAttemptsFallback.delete(userId);
    }
  }

  // ─── Session Cache Redis Helpers ──────────────────────────────────────

  private async getCachedSession(
    sessionToken: string,
  ): Promise<{ userId: number; session: any } | null> {
    if (this.redisService.isConnected) {
      return this.redisService.getJson<{ userId: number; session: any }>(
        `session:cache:${sessionToken}`,
      );
    }
    const cached = this.sessionCacheFallback.get(sessionToken);
    if (cached && Date.now() - cached.cachedAt < this.SESSION_CACHE_TTL_MS) {
      return { userId: cached.userId, session: cached.session };
    }
    return null;
  }

  private async setCachedSession(
    sessionToken: string,
    data: { userId: number; session: any },
  ): Promise<void> {
    if (this.redisService.isConnected) {
      await this.redisService.setJson(
        `session:cache:${sessionToken}`,
        data,
        60,
      ); // 60s TTL
    } else {
      this.sessionCacheFallback.set(sessionToken, {
        ...data,
        cachedAt: Date.now(),
      });
    }
  }

  private async deleteCachedSession(sessionToken: string): Promise<void> {
    if (this.redisService.isConnected) {
      await this.redisService.del(`session:cache:${sessionToken}`);
    } else {
      this.sessionCacheFallback.delete(sessionToken);
    }
  }

  /** A session that was just ended elsewhere (the Settings page) must stop working now, not when its cached copy runs out. */
  async forgetSession(sessionToken: string): Promise<void> {
    await this.deleteCachedSession(sessionToken);
  }

  // ─── Token Methods ────────────────────────────────────────────────────

  /**
   * Generate JWT token for a user with an embedded session token.
   *
   * The session token is required, not optional. `validateToken` only checks
   * revocation when the payload carries a `sid`, so a token issued without one
   * would survive "revoke all sessions" indefinitely. Making the parameter
   * mandatory means that cannot happen by omission.
   */
  async generateToken(user: any, sessionToken: string) {
    if (!sessionToken) {
      throw new Error(
        'generateToken requires a session token; unbound JWTs cannot be revoked',
      );
    }
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      sid: sessionToken,
    };

    return {
      access_token: this.jwtService.sign(payload),
    };
  }

  /**
   * Validate JWT token and its associated session
   */
  async validateToken(token: string): Promise<JwtPayload> {
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);

      // If the JWT contains a session token, validate the session too
      if (payload.sid) {
        await this.validateSession(payload.sid);
      }

      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      this.logger.error(`Token validation failed: ${error.message}`);
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Generate a 6-digit OTP code (exposed for controller use with pending signups)
   */
  generateOTPCode(): string {
    return this.emailService.generateOTP();
  }

  /**
   * Send an OTP email directly (no DB, for pending signups)
   */
  async sendOTPEmail(email: string, otp: string): Promise<boolean> {
    return this.emailService.sendOTPEmail(email, otp);
  }

  /**
   * Generate and send an OTP to an existing user's email
   * Stores OTP in database for existing users
   */
  async sendVerificationOTP(userId: number, options: { admin?: boolean } = {}): Promise<boolean> {
    try {
      const user = await this.usersService.findOne(userId);

      if (!user) {
        this.logger.error(`User not found for ID: ${userId}`);
        throw new NotFoundException('User not found');
      }

      this.logger.log(
        `Generating OTP for user: ${userId}, email: ${maskEmail(user.email)}`,
      );

      // Generate a new OTP code
      const otp = this.emailService.generateOTP();
      const expiresAt = new Date();
      expiresAt.setMinutes(expiresAt.getMinutes() + this.OTP_EXPIRY_MINUTES);

      this.logger.log(
        `Generated OTP for userId: ${userId} (expires in ${this.OTP_EXPIRY_MINUTES} minutes)`,
      );

      // Store the OTP in the database
      await this.prisma.client.oTP.create({
        data: {
          userId,
          code: otp,
          expiresAt,
        },
      });
      this.logger.log(`✓ OTP stored in database for user ${userId}`);

      // Reset brute-force counter when a fresh OTP is issued
      await this.deleteOtpAttempts(userId);

      // Send the OTP via email WITHOUT awaiting delivery.
      //
      // The login and send-otp endpoints return an identical body whether or
      // not the address is registered, but a registered address used to also
      // wait on an outbound HTTP call to the mail provider before responding.
      // That is a timing difference of hundreds of milliseconds, measurable
      // from anywhere, and it undid the uniform response. Dispatching the send
      // and returning immediately puts both paths on the same clock. Delivery
      // failures are logged, which is all the awaiting version did with them.
      void this.emailService
        .sendOTPEmail(user.email, otp, options)
        .then((sent) => {
          if (sent) {
            this.logger.log(`✓ OTP email sent successfully to user ${userId}`);
          } else {
            this.logger.error(`✗ Failed to send OTP email to user ${userId}`);
          }
        })
        .catch((err: unknown) => {
          this.logger.error(
            `✗ OTP email error for user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        });

      return true;
    } catch (error) {
      this.logger.error(`Error in sendVerificationOTP: ${error.message}`);
      return false;
    }
  }

  /**
   * Verify the OTP code provided by the user.
   * Enforces brute-force lockout: max 5 wrong attempts, then 15-minute lockout.
   */
  async verifyOTP(userId: number, code: string): Promise<boolean> {
    try {
      this.logger.log(`Verifying OTP for userId: ${userId}`);

      // ─ Brute-force check ──────────────────────────────────────
      const now = Date.now();
      const attempts = await this.getOtpAttempts(userId);
      if (attempts && attempts.lockedUntil > now) {
        const remainingSeconds = Math.ceil((attempts.lockedUntil - now) / 1000);
        this.logger.warn(
          `OTP lockout active for userId ${userId} (${remainingSeconds}s remaining)`,
        );
        throw new HttpException(
          `Too many failed attempts. Try again in ${Math.ceil(remainingSeconds / 60)} minute(s).`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      // ─ DB lookup ─────────────────────────────────────────────
      const otp = await this.prisma.client.oTP.findFirst({
        where: {
          userId,
          code,
          expiresAt: { gte: new Date() },
        },
      });

      if (!otp) {
        // Increment attempt counter
        const current = await this.getOtpAttempts(userId);
        current.count += 1;
        if (current.count >= this.OTP_MAX_ATTEMPTS) {
          current.lockedUntil = now + this.OTP_LOCKOUT_MS;
          current.count = 0; // reset counter so next window starts fresh
          this.logger.warn(
            `OTP lockout triggered for userId ${userId} after ${this.OTP_MAX_ATTEMPTS} failed attempts`,
          );
        }
        await this.setOtpAttempts(userId, current);
        this.logger.warn(
          `Invalid OTP for userId ${userId} (attempt ${current.count}/${this.OTP_MAX_ATTEMPTS})`,
        );
        return false;
      }

      // ─ Success ───────────────────────────────────────────────
      this.logger.log(`OTP verified successfully for user ${userId}`);

      // Clear the attempt counter on success
      await this.deleteOtpAttempts(userId);

      // Delete the OTP so it cannot be reused
      await this.prisma.client.oTP.delete({ where: { id: otp.id } });

      return true;
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error(`Failed to verify OTP: ${error.message}`);
      return false;
    }
  }

  /**
   * Verify the App 2FA (TOTP) code
   */
  async verifyApp2FA(userId: number, code: string): Promise<boolean> {
    try {
      const user = await this.prisma.client.user.findUnique({
        where: { id: userId },
      });
      if (!user || !user.twoFactorEnabled || !user.twoFactorSecret) {
        return false;
      }

      return speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token: code,
        window: 1, // Allow 30sec skew
      });
    } catch (error) {
      this.logger.error(`Error verifying App 2FA: ${error.message}`);
      return false;
    }
  }

  /**
   * Complete login after OTP verification and return user data with token
   */
  async completeLogin(
    userId: number,
    userAgent?: string,
    ipAddress?: string,
  ): Promise<{ user: any; token: string }> {
    try {
      // Get the user (works for both signup and login)
      const user = await this.usersService.findOne(userId);
      if (!user) {
        throw new NotFoundException('User not found');
      }
      // Every sign-in ends here (the emailed code, the authenticator, and the root password), so this one check keeps a disabled account out of all of them.
      if (user.accountStatus === 'suspended') {
        throw new ForbiddenException(SUSPENDED_MESSAGE);
      }

      // Mark user as verified (first time for signup, redundant for login)
      await this.usersService.update(user.id, { verified: true });

      // Generate a unique session token
      const sessionToken = randomBytes(48).toString('hex');
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + this.SESSION_DURATION_DAYS);

      // Create session with full device/IP tracking
      const deviceInfo = this.parseUserAgent(userAgent || 'Unknown');
      await this.prisma.client.session.create({
        data: {
          userId: user.id,
          token: sessionToken,
          deviceType: deviceInfo.deviceType,
          browser: deviceInfo.browser,
          os: deviceInfo.os,
          ipAddress: ipAddress || null,
          // The country the address is registered in, as a two-letter code. Looked up locally.
          location: countryOf(ipAddress),
          isActive: true,
          expiresAt,
        },
      });

      this.logger.log(
        `Session created for user ${userId} on ${deviceInfo.browser} / ${deviceInfo.os} (expires ${expiresAt.toISOString()})`,
      );

      // Generate JWT that embeds the session token
      const { access_token } = await this.generateToken(user, sessionToken);

      this.logger.log(`User ${userId} logged in successfully`);

      return {
        user,
        token: access_token,
      };
    } catch (error) {
      this.logger.error(`Error in completeLogin: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validate a session token: checks it's active and not expired.
   * Uses a Redis-backed cache (with in-memory fallback) to avoid hitting the DB on every request.
   * Extends the session if user has been active recently.
   */
  async validateSession(
    sessionToken: string,
  ): Promise<{ userId: number; session: any }> {
    // Check cache first
    const cached = await this.getCachedSession(sessionToken);
    if (cached) {
      return { userId: cached.userId, session: cached.session };
    }

    // Cache miss, hit the database
    const found = await this.prisma.client.session.findUnique({
      where: { token: sessionToken },
      include: { user: { select: { accountStatus: true } } },
    });

    if (!found) {
      await this.deleteCachedSession(sessionToken);
      throw new UnauthorizedException('Session not found');
    }
    const { user: owner, ...session } = found;

    // Disabling an account ends its sessions, but a session is also refused on its own account's state, so nothing that missed that sweep keeps working.
    if (owner?.accountStatus === 'suspended') {
      await this.deleteCachedSession(sessionToken);
      throw new UnauthorizedException(SUSPENDED_MESSAGE);
    }

    if (!session.isActive) {
      await this.deleteCachedSession(sessionToken);
      throw new UnauthorizedException('Session has been deactivated');
    }

    if (new Date() > session.expiresAt) {
      // Deactivate the expired session
      await this.prisma.client.session.update({
        where: { id: session.id },
        data: { isActive: false },
      });
      await this.deleteCachedSession(sessionToken);
      throw new UnauthorizedException('Session expired');
    }

    // Extend session if last activity was more than threshold ago
    const hoursSinceLastActive =
      (Date.now() - session.lastActive.getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastActive >= this.SESSION_EXTEND_THRESHOLD_HOURS) {
      const newExpiresAt = new Date();
      newExpiresAt.setDate(newExpiresAt.getDate() + this.SESSION_DURATION_DAYS);
      // Fire and forget: don't block the request for a session extension
      this.prisma.client.session
        .update({
          where: { id: session.id },
          data: {
            lastActive: new Date(),
            expiresAt: newExpiresAt,
          },
        })
        .catch((err) =>
          this.logger.error(`Session extend failed: ${err.message}`),
        );
    }

    // Cache the validated session
    await this.setCachedSession(sessionToken, {
      userId: session.userId,
      session,
    });

    return { userId: session.userId, session };
  }

  /**
   * Deactivate a specific session (logout)
   */
  async deactivateSession(sessionToken: string): Promise<void> {
    try {
      await this.prisma.client.session.update({
        where: { token: sessionToken },
        data: { isActive: false },
      });
      await this.deleteCachedSession(sessionToken);
      this.logger.log(`Session deactivated`);
    } catch (error) {
      this.logger.error(`Error deactivating session: ${error.message}`);
    }
  }

  /**
   * Deactivate all sessions for a user (logout everywhere)
   */
  async deactivateAllSessions(userId: number): Promise<void> {
    await this.prisma.client.session.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });
    this.logger.log(`All sessions deactivated for user ${userId}`);
  }

  /**
   * End every session an account has and drop each from the session cache, so none of them works for even the minute a cached copy would last. Used when an administrator disables an account, signs it out everywhere, changes its address, or deletes it. Returns how many were live.
   */
  async endAllSessions(userId: number): Promise<number> {
    const sessions = await this.prisma.client.session.findMany({
      where: { userId, isActive: true },
      select: { token: true, expiresAt: true },
    });
    await this.prisma.client.session.updateMany({
      where: { userId, isActive: true },
      data: { isActive: false },
    });
    await Promise.all(sessions.map((s) => this.deleteCachedSession(s.token)));
    return sessions.filter((s) => s.expiresAt > new Date()).length;
  }

  /**
   * Get all active sessions for a user
   */
  async getActiveSessions(userId: number) {
    return this.prisma.client.session.findMany({
      where: { userId, isActive: true, expiresAt: { gt: new Date() } },
      orderBy: { lastActive: 'desc' },
      select: {
        id: true,
        deviceType: true,
        browser: true,
        os: true,
        ipAddress: true,
        location: true,
        lastActive: true,
        createdAt: true,
      },
    });
  }

  async getActiveSessionsPaginated(
    userId: number,
    query: { page: number; limit: number; sort: string; order: 'asc' | 'desc' },
  ) {
    const { page, limit, sort, order } = query;
    const skip = (page - 1) * limit;

    const allowedSorts = ['lastActive', 'createdAt', 'browser', 'os'];
    const sortField = allowedSorts.includes(sort) ? sort : 'lastActive';

    const where = { userId, isActive: true, expiresAt: { gt: new Date() } };

    const [data, total] = await Promise.all([
      this.prisma.client.session.findMany({
        where,
        orderBy: { [sortField]: order },
        select: {
          id: true,
          deviceType: true,
          browser: true,
          os: true,
          ipAddress: true,
          location: true,
          lastActive: true,
          createdAt: true,
        },
        skip,
        take: limit,
      }),
      this.prisma.client.session.count({ where }),
    ]);

    const totalPages = Math.ceil(total / limit);
    return {
      data,
      meta: {
        page,
        limit,
        total,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  }

  private parseUserAgent(userAgent: string): {
    deviceType: string;
    browser: string;
    os: string;
  } {
    const ua = userAgent.toLowerCase();

    // Detect device type
    let deviceType = 'desktop';
    if (
      ua.includes('mobile') ||
      ua.includes('android') ||
      ua.includes('iphone')
    ) {
      deviceType = 'mobile';
    } else if (ua.includes('tablet') || ua.includes('ipad')) {
      deviceType = 'tablet';
    }

    // Detect browser
    let browser = 'Unknown';
    if (ua.includes('edg')) {
      // Edge must be checked before Chrome
      browser = 'Edge';
    } else if (ua.includes('chrome') || ua.includes('crios')) {
      browser = 'Chrome';
    } else if (ua.includes('firefox') || ua.includes('fxios')) {
      browser = 'Firefox';
    } else if (ua.includes('safari')) {
      browser = 'Safari';
    } else if (ua.includes('opera') || ua.includes('opr')) {
      browser = 'Opera';
    }

    // Detect OS
    let os = 'Unknown';
    // Windows 11 reports the same NT 10.0 token as Windows 10.
    // Check for the Windows 11 UA hint first (sent by modern Chromium-based browsers).
    if (ua.includes('windows nt 10')) {
      // Chromium 90+ sends "Windows NT 10.0; Win64; x64" for both 10 and 11.
      // The only reliable signal shipped in a standard UA is the presence of
      // "Windows NT 10.0" with a build number ≥ 22000 via the Sec-CH-UA-Platform-Version
      // header. Without that we can only say "Windows 10/11".
      os = 'Windows 10/11';
    } else if (ua.includes('windows nt 6.3')) {
      os = 'Windows 8.1';
    } else if (ua.includes('windows nt 6.2')) {
      os = 'Windows 8';
    } else if (ua.includes('windows nt 6.1')) {
      os = 'Windows 7';
    } else if (ua.includes('windows')) {
      os = 'Windows';
    } else if (ua.includes('mac os x')) {
      // Extract version if possible
      const match = ua.match(/mac os x (\d+)[_.](\d+)/);
      if (match) {
        os = `macOS ${match[1]}.${match[2]}`;
      } else {
        os = 'macOS';
      }
    } else if (ua.includes('iphone')) {
      os = 'iOS';
    } else if (ua.includes('ipad')) {
      os = 'iPadOS';
    } else if (ua.includes('android')) {
      // Extract version if possible
      const match = ua.match(/android (\d+(?:\.\d+)?)/);
      if (match) {
        os = `Android ${match[1]}`;
      } else {
        os = 'Android';
      }
    } else if (ua.includes('linux')) {
      os = 'Linux';
    }

    return { deviceType, browser, os };
  }
}
