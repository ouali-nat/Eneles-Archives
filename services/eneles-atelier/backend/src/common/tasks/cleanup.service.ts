// Requires: npm install @nestjs/schedule
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { UsersService } from '../../users/users.service';

@Injectable()
export class CleanupService {
  private readonly logger = new Logger(CleanupService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  /** Days a deleted account is kept (for abuse reports) before it is erased. */
  static readonly DELETED_ACCOUNT_GRACE_DAYS = 30;

  /**
   * Erase accounts deleted more than the grace period ago. The privacy policy
   * promises projects and uploads go when the account does; before this job
   * they stayed until someone re-registered the same address.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async handleDeletedAccounts() {
    const cutoff = new Date(Date.now() - CleanupService.DELETED_ACCOUNT_GRACE_DAYS * 24 * 3600 * 1000);
    const due = await this.prisma.client.user.findMany({
      where: { accountStatus: 'deleted', updatedAt: { lt: cutoff }, NOT: { email: { endsWith: '@deleted.invalid' } } },
      select: { id: true },
      take: 100,
    });
    let erased = 0;
    for (const { id } of due) {
      try {
        if (await this.users.purgeDeletedAccount(id)) erased++;
      } catch (err) {
        this.logger.error(`Could not erase deleted account ${id}: ${(err as Error).message}`);
      }
    }
    if (erased) this.logger.log(`Erased ${erased} deleted account(s)`);
  }

  /**
   * Remove expired OTP codes every hour.
   * The OTP model has an `expiresAt` field set at creation time.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleExpiredOTPs() {
    const result = await this.prisma.client.oTP.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(`Cleaned up ${result.count} expired OTP(s)`);
    }
  }

  /**
   * Remove expired and stale sessions every 6 hours.
   *  - Sessions past their `expiresAt` timestamp.
   *  - Inactive sessions (`isActive = false`) that haven't been touched in 7 days.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async handleExpiredSessions() {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const result = await this.prisma.client.session.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: new Date() } },
          { isActive: false, lastActive: { lt: sevenDaysAgo } },
        ],
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `Cleaned up ${result.count} expired/inactive session(s)`,
      );
    }
  }

  /**
   * Remove expired file-history snapshots daily at 3 AM.
   * Each `FileHistory` row has an `expiresAt` (createdAt + 30 days).
   */
  @Cron('0 3 * * *')
  async handleExpiredFileHistory() {
    const result = await this.prisma.client.fileHistory.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    });
    if (result.count > 0) {
      this.logger.log(
        `Cleaned up ${result.count} expired file-history entry/entries`,
      );
    }
  }

  /**
   * Remove expired project invitations daily at 4 AM.
   * Invitations that are still `pending` past their `expiresAt` are stale.
   */
  @Cron('0 4 * * *')
  async handleExpiredInvitations() {
    const result = await this.prisma.client.projectInvitation.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
        status: 'pending',
      },
    });
    if (result.count > 0) {
      this.logger.log(
        `Cleaned up ${result.count} expired project invitation(s)`,
      );
    }
  }
}
