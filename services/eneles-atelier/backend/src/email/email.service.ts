import { maskEmail } from '../common/utils/mask-email';
import { maskCodes } from './email-events';
import { PrismaService } from '../prisma/prisma.service';
import {
  Injectable,
  Logger,
  BadRequestException,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';
import { randomInt } from 'crypto';

@Injectable()
export class EmailService {
  /**
   * Null when RESEND_API_KEY is unset. The Resend constructor throws on a
   * missing key, which used to take the entire application down at boot while
   * the log claimed email would merely "not work". Now it actually just does
   * not work: sends fail with a clear error and everything else runs.
   */
  private readonly resend: Resend | null;
  private readonly from: string | null;
  /**
   * Outside production, a server without a mail provider writes each message
   * to its log instead of failing, so sign-in and invitations work on a local
   * stack. Production never takes this path.
   */
  private readonly logOnly: boolean;
  private readonly logger = new Logger(EmailService.name);

  constructor(
    private configService: ConfigService,
    @Optional() private readonly prisma?: PrismaService,
  ) {
    const resendApiKey = this.configService.get<string>('RESEND_API_KEY');
    if (!resendApiKey) {
      this.logger.warn(
        'RESEND_API_KEY is not defined. Email functionality will not work.',
      );
      this.resend = null;
    } else {
      this.resend = new Resend(resendApiKey);
    }

    this.from = this.configService.get<string>('EMAIL_FROM') || null;
    if (!this.from) {
      this.logger.warn(
        'EMAIL_FROM is not defined. Email functionality will not work.',
      );
    }

    this.logOnly =
      !this.resend &&
      this.configService.get<string>('NODE_ENV') !== 'production';
    if (this.logOnly) {
      this.logger.warn(
        'No mail provider: messages are written to this log (development only).',
      );
    }
  }

  /** Text interpolated into an email's HTML (names, titles, links). */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private requireClient(): Resend {
    if (!this.resend) {
      throw new Error(
        'Email is not configured: RESEND_API_KEY is not set on this server',
      );
    }
    return this.resend;
  }

  private requireFrom(): string {
    if (!this.from) {
      throw new Error(
        'Email is not configured: EMAIL_FROM is not set on this server',
      );
    }
    return this.from;
  }

  /**
   * Generate a cryptographically secure random OTP code
   */
  generateOTP(length = 6): string {
    let otp = '';

    for (let i = 0; i < length; i++) {
      otp += randomInt(10).toString();
    }

    return otp;
  }

  /**
   * Validate an email address
   */
  private validateEmail(email: string): boolean {
    // Simple regex for email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Addresses that can never receive mail: the domains reserved for documentation and testing (RFC 2606 and RFC 6761). Seeded and test accounts use them. Sending to them only produces bounces, which count against the sending domain's reputation, so nothing is sent: the message is written to the log instead.
   */
  private undeliverable(email: string): boolean {
    const domain = email.trim().toLowerCase().split('@').pop() ?? '';
    return /(^|\.)(example\.(com|org|net)|test|invalid|localhost|example)$/.test(
      domain,
    );
  }

  /**
   * Shared email wrapper: branded layout with logo + footer
   */
  private emailLayout(content: string): string {
    return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Eneles</title>
</head>
<body style="margin: 0; padding: 0; background-color: #0a0a0a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 460px; margin: 0 auto;">

          <!-- Logo -->
          <tr>
            <td align="center" style="padding-bottom: 32px;">
              <img src="https://texer.org/branding/logo/Dark.png" alt="Eneles" width="100" style="display: block;" />
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color: #141414; border: 1px solid #262626; border-radius: 12px; padding: 40px 36px;">
              ${content}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding-top: 32px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="padding: 0 10px;">
                    <a href="https://texer.org" style="color: #525252; font-size: 12px; text-decoration: none;">Website</a>
                  </td>
                  <td style="color: #333; font-size: 12px;">·</td>
                  <td style="padding: 0 10px;">
                    <a href="https://texer.org/terms" style="color: #525252; font-size: 12px; text-decoration: none;">Terms</a>
                  </td>
                  <td style="color: #333; font-size: 12px;">·</td>
                  <td style="padding: 0 10px;">
                    <a href="https://texer.org/privacy" style="color: #525252; font-size: 12px; text-decoration: none;">Privacy</a>
                  </td>
                </tr>
              </table>
              <p style="color: #404040; font-size: 11px; margin: 12px 0 0 0; line-height: 1.4;">
                © ${new Date().getFullYear()} Eneles
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  }

  /**
   * Send an OTP code to the user's email
   */
  async sendOTPEmail(
    email: string,
    otp: string,
    options: { admin?: boolean } = {},
  ): Promise<boolean> {
    // A sign-in to the operators' panel is marked in the subject and the heading, so it is never mistaken for an ordinary sign-in in the inbox.
    const admin = options.admin === true;
    // Validate email
    if (!email || !this.validateEmail(email)) {
      this.logger.error(`Invalid email address: ${maskEmail(email)}`);
      return false;
    }

    // Outside production a code for a test address is written to the log, as every code is when there is no mail provider. In production a code is never logged: mail to a test address is refused.
    const reserved = this.undeliverable(email);
    if (
      this.logOnly ||
      (reserved && this.configService.get<string>('NODE_ENV') !== 'production')
    ) {
      this.logger.warn(
        `[mail, not sent] ${admin ? 'admin sign-in' : 'verification'} code for ${email}: ${otp}`,
      );
      return true;
    }
    if (reserved) return false;

    try {
      const { data, error } = await this.requireClient().emails.send({
        from: this.requireFrom(),
        to: email,
        subject: admin
          ? `[Admin] ${otp} is your Eneles admin sign-in code`
          : `${otp} is your Eneles verification code`,
        html: this.emailLayout(`
              <!-- Heading -->
              <h1 style="color: #fafafa; font-size: 20px; font-weight: 600; margin: 0 0 8px 0; text-align: center; letter-spacing: -0.3px;">
                ${admin ? 'Admin sign-in code' : 'Verification code'}
              </h1>
              <p style="color: #737373; font-size: 14px; line-height: 1.5; margin: 0 0 28px 0; text-align: center;">
                ${admin ? 'Someone is signing in to the Eneles admin panel with this address. Enter this code there. If it was not you, ignore this email and tell the other administrators.' : 'Enter this code to verify your identity'}
              </p>

              <!-- OTP Code (copy-friendly) -->
              <div style="margin: 0 auto 28px auto; text-align: center;">
                <p style="font-size: 32px; font-weight: 700; color: #fafafa; font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace; letter-spacing: 10px; margin: 0; padding: 16px 0;">
                  ${otp}
                </p>
              </div>

              <!-- Divider -->
              <div style="height: 1px; background-color: #262626; margin: 0 0 20px 0;"></div>

              <!-- Info -->
              <p style="color: #525252; font-size: 12px; line-height: 1.6; margin: 0; text-align: center;">
                This code expires in <strong style="color: #737373;">10 minutes</strong>.<br />
                If you didn't request this, you can safely ignore this email.
              </p>
        `),
      });

      if (error) {
        this.logger.error(
          `Failed to send email to ${maskEmail(email)}: ${error.message}`,
        );
        return false;
      }

      this.logger.log(`Successfully sent OTP email to ${maskEmail(email)}`);
      // The subject holds the code, so it is not kept.
      void this.recordSent(
        data?.id,
        admin ? 'admin sign-in code' : 'sign-in code',
        [email],
        null,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Exception when sending email to ${email}: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * Send a project collaboration invite email
   */
  async sendProjectInviteEmail(
    toEmail: string,
    inviterName: string,
    projectTitle: string,
    role: string,
    acceptUrl: string,
  ): Promise<boolean> {
    if (!toEmail || !this.validateEmail(toEmail)) {
      this.logger.error(
        `Invalid email address for invite: ${maskEmail(toEmail)}`,
      );
      return false;
    }

    const roleLabel = role === 'editor' ? 'Editor' : 'Viewer';

    if (
      this.logOnly ||
      (this.undeliverable(toEmail) &&
        this.configService.get<string>('NODE_ENV') !== 'production')
    ) {
      this.logger.warn(
        `[mail, not sent] ${inviterName} invited ${toEmail} to "${projectTitle}" as ${roleLabel}: ${acceptUrl}`,
      );
      return true;
    }

    const inviter = this.escapeHtml(inviterName);
    const title = this.escapeHtml(projectTitle);
    const href = this.escapeHtml(acceptUrl);

    try {
      const { data, error } = await this.requireClient().emails.send({
        from: this.requireFrom(),
        to: toEmail,
        subject: `${inviterName} invited you to "${projectTitle}" | Eneles`,
        html: this.emailLayout(`
              <!-- Heading -->
              <h1 style="color: #fafafa; font-size: 20px; font-weight: 600; margin: 0 0 8px 0; text-align: center; letter-spacing: -0.3px;">
                Project Invitation
              </h1>
              <p style="color: #737373; font-size: 14px; line-height: 1.6; margin: 0 0 28px 0; text-align: center;">
                <strong style="color: #d4d4d4;">${inviter}</strong> has invited you to collaborate on
              </p>

              <!-- Project name card -->
              <div style="background-color: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 16px 20px; margin: 0 0 12px 0; text-align: center;">
                <p style="color: #fafafa; font-size: 16px; font-weight: 600; margin: 0 0 6px 0; letter-spacing: -0.2px;">
                  ${title}
                </p>
                <span style="display: inline-block; background-color: #262626; color: #a3a3a3; font-size: 11px; font-weight: 500; padding: 3px 10px; border-radius: 99px; text-transform: uppercase; letter-spacing: 0.5px;">
                  ${roleLabel} access
                </span>
              </div>

              <!-- CTA Button -->
              <div style="text-align: center; margin: 24px 0 28px 0;">
                <a href="${href}" style="display: inline-block; padding: 12px 36px; background-color: #fafafa; color: #0a0a0a; text-decoration: none; border-radius: 8px; font-size: 14px; font-weight: 600; letter-spacing: -0.2px;">
                  Accept Invitation
                </a>
              </div>

              <!-- Divider -->
              <div style="height: 1px; background-color: #262626; margin: 0 0 20px 0;"></div>

              <!-- Info -->
              <p style="color: #525252; font-size: 12px; line-height: 1.6; margin: 0; text-align: center;">
                This invitation expires in <strong style="color: #737373;">7 days</strong>.<br />
                If you don't have an account, you'll be prompted to create one.
              </p>
        `),
      });

      if (error) {
        this.logger.error(
          `Failed to send invite email to ${toEmail}: ${error.message}`,
        );
        return false;
      }

      this.logger.log(
        `Successfully sent project invite email to ${maskEmail(toEmail)}`,
      );
      void this.recordSent(
        data?.id,
        'invitation',
        [toEmail],
        `${inviterName} invited you to "${projectTitle}" | Eneles`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Exception when sending invite email to ${toEmail}: ${error.message}`,
      );
      return false;
    }
  }

  /**
   * A message from the site's contact form, to the team's inbox (CONTACT_TO, else contact@texer.org), with the sender as the reply-to address so a reply goes straight back to them. Outside production it is only written to this log: trying the form while building the site must never fill the team's inbox.
   */
  async sendContactMessage(input: {
    name: string;
    email: string;
    topic: string;
    message: string;
  }): Promise<boolean> {
    const to =
      this.configService.get<string>('CONTACT_TO') || 'contact@texer.org';
    const live = this.configService.get<string>('NODE_ENV') === 'production';
    if (this.logOnly || !live) {
      this.logger.warn(
        `[mail, not sent] Contact form, ${input.topic}, from ${input.name} <${maskEmail(input.email)}>: ${input.message.slice(0, 200)}`,
      );
      return true;
    }
    const name = this.escapeHtml(input.name);
    const topic = this.escapeHtml(input.topic);
    const body = this.escapeHtml(input.message).replace(/\n/g, '<br />');
    try {
      const { data, error } = await this.requireClient().emails.send({
        from: this.requireFrom(),
        to,
        replyTo: input.email,
        subject: `${input.topic}: ${input.name} | Eneles contact form`,
        text: `${input.topic}\nFrom: ${input.name} <${input.email}>\n\n${input.message}`,
        html: this.emailLayout(`
              <p style="color: #737373; font-size: 12px; margin: 0 0 6px 0; text-transform: uppercase; letter-spacing: 0.5px;">${topic}</p>
              <h1 style="color: #fafafa; font-size: 18px; font-weight: 600; margin: 0 0 20px 0;">${name}</h1>
              <div style="background-color: #1a1a1a; border: 1px solid #2a2a2a; border-radius: 8px; padding: 16px 20px; color: #d4d4d4; font-size: 14px; line-height: 1.6;">${body}</div>
              <p style="color: #525252; font-size: 12px; margin: 20px 0 0 0;">Reply to this email to answer ${name}.</p>
        `),
      });
      if (error) {
        this.logger.error(`Failed to send a contact message: ${error.message}`);
        return false;
      }
      void this.recordSent(
        data?.id,
        'contact',
        [to],
        `${input.topic}: ${input.name} | Eneles contact form`,
      );
      return true;
    } catch (error) {
      this.logger.error(
        `Exception when sending a contact message: ${(error as Error).message}`,
      );
      return false;
    }
  }

  /** Keeps a record of an email Resend accepted, for the admin panel's Email page; Resend's webhook then fills in what happened to it. Never fails a send: a record that cannot be written is logged and dropped. */
  private async recordSent(
    resendId: string | undefined,
    kind: string,
    recipients: string[],
    subject: string | null,
  ): Promise<void> {
    if (!this.prisma || !resendId) return;
    try {
      await this.prisma.client.emailMessage.upsert({
        where: { resendId },
        create: {
          resendId,
          kind,
          recipients,
          sender: this.from,
          subject: subject ? maskCodes(subject) : null,
        },
        update: {
          kind,
          recipients,
          subject: subject ? maskCodes(subject) : null,
        },
      });
    } catch (error) {
      this.logger.warn(
        `Could not record a sent email: ${(error as Error).message}`,
      );
    }
  }
}
