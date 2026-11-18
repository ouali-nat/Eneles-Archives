import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AuditEvent {
  userId?: number | null;
  action: string;
  resource?: string;
  resourceId?: string;
  outcome?: 'success' | 'failure' | 'blocked';
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Record a security-relevant event.
   * Fire-and-forget: never throws, because a logging failure must never break the request.
   */
  async log(event: AuditEvent): Promise<void> {
    try {
      await this.prisma.client.auditLog.create({
        data: {
          userId: event.userId ?? null,
          action: event.action,
          resource: event.resource ?? null,
          resourceId: event.resourceId ?? null,
          outcome: event.outcome ?? 'success',
          ipAddress: event.ipAddress ?? null,
          userAgent: event.userAgent ? event.userAgent.slice(0, 255) : null,
          metadata: (event.metadata as any) ?? undefined,
        },
      });
    } catch (err: any) {
      // Log to console but NEVER propagate: audit failure is not fatal
      this.logger.error(`Audit log write failed: ${err.message}`, err.stack);
    }
  }

  /**
   * Convenience: log a login attempt outcome.
   */
  async logAuth(
    action: 'login.otp_sent' | 'login.success' | 'login.fail' | 'login.otp_lockout' |
            'signup.initiated' | 'signup.success' | 'logout' |
            'otp.fail' | 'otp.lockout' | '2fa.fail' | '2fa.success',
    opts: Pick<AuditEvent, 'userId' | 'ipAddress' | 'userAgent' | 'outcome' | 'metadata'>,
  ): Promise<void> {
    return this.log({ action, resource: 'auth', ...opts });
  }

  /**
   * Convenience: log a resource mutation.
   */
  async logResource(
    action: 'create' | 'update' | 'delete' | 'access',
    resource: string,
    resourceId: string,
    opts: Pick<AuditEvent, 'userId' | 'ipAddress' | 'userAgent' | 'outcome' | 'metadata'>,
  ): Promise<void> {
    return this.log({
      action: `${resource}.${action}`,
      resource,
      resourceId,
      ...opts,
    });
  }
}
