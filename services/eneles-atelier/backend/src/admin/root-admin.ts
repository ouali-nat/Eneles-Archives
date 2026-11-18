import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The root administrator: one account, named by ADMIN_EMAIL, that is always an administrator and is the only account that can give others the administrator flag (`users.isAdmin`; it can also be set by hand in the database).
 *
 * There are no passwords anywhere. The root account signs in to the operators' panel like every other administrator, with a code emailed to its address, so ADMIN_EMAIL must be a mailbox someone reads. Its row is made at startup, so the panel can send it a code on the first sign-in.
 */
@Injectable()
export class RootAdmin implements OnModuleInit {
  private readonly logger = new Logger(RootAdmin.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /** The root account's address, lower-cased, or null when none is set. */
  get email(): string | null {
    return this.config.get<string>('ADMIN_EMAIL')?.trim().toLowerCase() || null;
  }

  isRoot(email: string | null | undefined): boolean {
    return !!email && !!this.email && email.trim().toLowerCase() === this.email;
  }

  /** The root account's row, made on first use so that codes, sessions, and the audit log have someone to point at. */
  async account() {
    const email = this.email!;
    return this.prisma.client.user.upsert({
      where: { email },
      create: { email, name: 'Administrator', verified: true, isAdmin: true },
      update: { isAdmin: true, verified: true, accountStatus: 'active' },
    });
  }

  async onModuleInit() {
    if (!this.email) return;
    try {
      await this.account();
    } catch (err) {
      this.logger.error(
        `Could not prepare the root administrator account: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
