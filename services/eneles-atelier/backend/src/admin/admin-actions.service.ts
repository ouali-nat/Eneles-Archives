import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { UsersService } from '../users/users.service';
import { BillingService } from '../billing/billing.service';
import { CollaborationGateway } from '../collaboration/collaboration.gateway';
import { RootAdmin } from './root-admin';

/** The administrator making a change, as `AdminGuard` puts it on the request. */
export interface Actor {
  id: number;
  email: string;
  name: string;
  root: boolean;
}

export const PLANS = ['free', 'pro', 'team', 'enterprise'] as const;
export type Plan = (typeof PLANS)[number];

/** A deliberately plain check: one @, something on each side, a dot in the domain, no spaces. The address is proved by the code its owner receives at the next sign-in. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * What an administrator can do to an account from the panel.
 *
 * Who may do what:
 * - Every administrator: disable and enable an account, sign it out everywhere, mark its email verified, turn off its two-factor sign-in, and change its plan.
 * - The root administrator only: delete an account, change its email address, give or take the administrator flag, and any action on another administrator's account.
 * - Nobody, from the panel: any action on the root account, or on one's own account (each of these would lock the administrator out, or let them grant themselves something).
 *
 * The controller writes each change to the audit log with the administrator who made it.
 */
@Injectable()
export class AdminActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly users: UsersService,
    private readonly billing: BillingService,
    private readonly collaboration: CollaborationGateway,
    private readonly root: RootAdmin,
  ) {}

  private get db() {
    return this.prisma.client;
  }

  /** The account an action is for, after every rule about who may act on it. */
  private async target(
    actor: Actor,
    id: number,
    options: { rootOnly?: boolean; allowDeleted?: boolean } = {},
  ) {
    const user = await this.db.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        accountStatus: true,
        isAdmin: true,
        verified: true,
        twoFactorEnabled: true,
        subscriptionType: true,
      },
    });
    if (!user) throw new NotFoundException('No such account');
    if (this.root.isRoot(user.email))
      throw new ForbiddenException(
        'The root administrator account cannot be changed from the panel.',
      );
    if (user.id === actor.id)
      throw new ForbiddenException(
        'You cannot do this to your own account from the panel.',
      );
    if (options.rootOnly && !actor.root)
      throw new ForbiddenException('Only the root administrator can do this.');
    if (user.isAdmin && !actor.root)
      throw new ForbiddenException(
        "Only the root administrator can change another administrator's account.",
      );
    if (user.accountStatus === 'deleted' && !options.allowDeleted)
      throw new ConflictException('This account has been deleted.');
    return user;
  }

  /** End every session the account has, drop them from the session cache, and close its open editor connections. */
  private async endEverything(userId: number) {
    const sessions = await this.auth.endAllSessions(userId);
    const sockets = this.collaboration.disconnectUser(userId);
    return { sessions, sockets };
  }

  /** Disable an account (it cannot sign in, and its sessions end now) or enable it again. */
  async setStatus(actor: Actor, id: number, suspended: boolean) {
    const user = await this.target(actor, id);
    if (suspended) {
      if (user.accountStatus === 'suspended')
        throw new ConflictException('This account is already disabled.');
      await this.db.user.update({
        where: { id },
        data: { accountStatus: 'suspended' },
      });
      const ended = await this.endEverything(id);
      return { id, status: 'suspended', sessionsEnded: ended.sessions };
    }
    if (user.accountStatus !== 'suspended')
      throw new ConflictException('This account is not disabled.');
    await this.db.user.update({
      where: { id },
      data: { accountStatus: 'active' },
    });
    return { id, status: 'active', sessionsEnded: 0 };
  }

  async signOutEverywhere(actor: Actor, id: number) {
    await this.target(actor, id);
    const ended = await this.endEverything(id);
    return { id, sessionsEnded: ended.sessions };
  }

  async markVerified(actor: Actor, id: number) {
    const user = await this.target(actor, id);
    if (user.verified)
      throw new ConflictException('This address is already verified.');
    await this.db.user.update({ where: { id }, data: { verified: true } });
    return { id, verified: true };
  }

  /** For someone who lost their authenticator: the next sign-in asks only for the emailed code. */
  async disableTwoFactor(actor: Actor, id: number) {
    const user = await this.target(actor, id);
    if (!user.twoFactorEnabled)
      throw new ConflictException(
        'Two-factor sign-in is already off for this account.',
      );
    await this.db.user.update({
      where: { id },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
    return { id, twoFactorEnabled: false };
  }

  /** The plan on the account only. Stripe is not told: nothing is charged, refunded, or canceled. */
  async setPlan(actor: Actor, id: number, plan: unknown) {
    if (!PLANS.includes(plan as Plan))
      throw new BadRequestException(
        `The plan must be one of ${PLANS.join(', ')}.`,
      );
    const user = await this.target(actor, id);
    if (user.subscriptionType === plan)
      throw new ConflictException(
        `This account is already on the ${String(plan)} plan.`,
      );
    await this.db.user.update({
      where: { id },
      data: { subscriptionType: plan as Plan },
    });
    return { id, from: user.subscriptionType, to: plan as Plan };
  }

  /** Root only. Every session carries the old address, so the account is signed out everywhere and signs in again with the new one. */
  async changeEmail(actor: Actor, id: number, raw: unknown) {
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!email || email.length > 254 || !EMAIL.test(email))
      throw new BadRequestException('Enter a valid email address.');
    const user = await this.target(actor, id, { rootOnly: true });
    if (email === user.email.toLowerCase())
      throw new BadRequestException(
        'That is already the address on this account.',
      );
    if (this.root.isRoot(email))
      throw new ConflictException(
        'That address belongs to the root administrator.',
      );
    const taken = await this.db.user.findFirst({
      where: { email: { equals: email, mode: 'insensitive' }, NOT: { id } },
      select: { id: true },
    });
    if (taken)
      throw new ConflictException('Another account already uses this address.');
    await this.db.user.update({ where: { id }, data: { email } });
    // Codes already sent went to the old address.
    await this.db.oTP.deleteMany({ where: { userId: id } });
    const ended = await this.endEverything(id);
    return { id, from: user.email, to: email, sessionsEnded: ended.sessions };
  }

  /** Root only. The same soft delete as the person's own "Delete account": the subscription ends now, sessions and API keys go, and the data is erased after the grace period. */
  async remove(actor: Actor, id: number, confirmEmail: unknown) {
    const user = await this.target(actor, id, { rootOnly: true });
    if (
      typeof confirmEmail !== 'string' ||
      confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()
    ) {
      throw new BadRequestException(
        "Type the account's email address exactly to confirm.",
      );
    }
    await this.billing.endForDeletedAccount(id);
    // Before the soft delete, which marks the sessions inactive without clearing the session cache.
    const ended = await this.endEverything(id);
    await this.users.remove(id);
    return { id, deleted: true, sessionsEnded: ended.sessions };
  }
}
