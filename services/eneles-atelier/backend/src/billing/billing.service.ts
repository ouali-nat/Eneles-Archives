import { siteUrls } from '../common/site';
import { Injectable, NotFoundException, BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { PLANS_PAUSED, plansActive } from '../common/billing';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StripeService } from './stripe.service';

const SOLD_PLANS = ['pro', 'team', 'enterprise'] as const;
type SoldPlan = (typeof SOLD_PLANS)[number];

@Injectable()
export class BillingService {
  constructor(
    private prisma: PrismaService,
    private stripeService: StripeService,
    private configService: ConfigService,
  ) {}

  /** Whether paid plans are on sale (BILLING_PLANS_ACTIVE; see common/billing). */
  get plansActive(): boolean {
    return plansActive(this.configService);
  }

  /** Buying (checkout, or restarting a plan) needs plans to be on sale. */
  private assertPlansActive() {
    if (!this.plansActive) throw new ServiceUnavailableException(PLANS_PAUSED);
  }

  /** Someone with a real Stripe subscription: while plans are paused they can still see, manage, and cancel it. */
  private async paysThroughStripe(userId: number): Promise<boolean> {
    if (this.stripeService.isStubbed) return false;
    const record = await this.prisma.client.subscription.findUnique({ where: { userId } });
    return !!record?.stripeSubscriptionId && !record.stripeSubscriptionId.startsWith('sub_dev_');
  }

  // Initialize Stripe customer for user
  async initializeCustomer(userId: number) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (user.subscription) {
      return user.subscription;
    }

    // Create Stripe customer. Stubbed: a local id, so the row is created and
    // every later call finds it, without ever contacting Stripe.
    const stripeCustomerId = this.stripeService.isStubbed
      ? `cus_dev_${userId}`
      : (await this.stripeService.createCustomer(user.email, user.name)).id;

    // Create subscription record
    const subscription = await this.prisma.client.subscription.create({
      data: {
        userId,
        stripeCustomerId,
        status: 'active',
      },
    });

    return subscription;
  }

  // Get subscription details
  async getSubscription(userId: number) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user) {
      throw new NotFoundException('User not found');
    }

    if (!user.subscription) {
      // Paused, nobody becomes a Stripe customer: the plan on the account is all there is.
      if (!this.plansActive) return { subscriptionType: user.subscriptionType, status: null, plansActive: false };
      // Auto-initialize if not exists
      return this.initializeCustomer(userId);
    }

    // If has Stripe subscription, get latest data
    if (user.subscription.stripeSubscriptionId && !this.stripeService.isStubbed) {
      const stripeSubscription = await this.stripeService.getSubscription(
        user.subscription.stripeSubscriptionId,
      );

      // Update local record
      await this.prisma.client.subscription.update({
        where: { id: user.subscription.id },
        data: {
          status: stripeSubscription.status as any,
          stripeCurrentPeriodEnd: new Date(
            (stripeSubscription as any).current_period_end * 1000,
          ),
          cancelAtPeriodEnd: (stripeSubscription as any).cancel_at_period_end,
        },
      });
    }

    return {
      ...user.subscription,
      subscriptionType: user.subscriptionType,
    };
  }

  /**
   * A plan's Stripe price id. The env files call it STRIPE_PRO_MONTHLY_PRICE_ID;
   * .env.example spells it STRIPE_PRICE_PRO_MONTHLY. Either name works.
   */
  private priceFor(plan: SoldPlan, interval: 'monthly' | 'yearly'): string | null {
    const p = plan.toUpperCase();
    const i = interval.toUpperCase();
    return (
      this.configService.get<string>(`STRIPE_${p}_${i}_PRICE_ID`) ||
      this.configService.get<string>(`STRIPE_PRICE_${p}_${i}`) ||
      null
    );
  }

  /** Which plan a Stripe price id sells, if any. */
  private planForPrice(priceId: string | undefined | null): SoldPlan | null {
    if (!priceId) return null;
    for (const plan of SOLD_PLANS) {
      if (priceId === this.priceFor(plan, 'monthly') || priceId === this.priceFor(plan, 'yearly')) {
        return plan;
      }
    }
    return null;
  }

  // Resolve price ID from plan + interval
  private resolvePriceId(plan?: string, interval?: string): string | null {
    const isYearly = interval === 'yearly' || interval === 'annual';
    if (plan !== 'pro' && plan !== 'team') return null;
    return this.priceFor(plan, isYearly ? 'yearly' : 'monthly');
  }

  // Create checkout session (accepts priceId directly or plan+interval to resolve from env)
  async createCheckoutSession(
    userId: number,
    body: { priceId?: string; plan?: string; interval?: string },
  ) {
    this.assertPlansActive();
    const stubbed = this.stripeService.isStubbed;
    let priceId = body.priceId;
    if (!priceId && body.plan) {
      priceId = stubbed
        ? // No price ids exist without Stripe; fabricate one so the row is
          // still descriptive.
          `price_dev_${body.plan}_${body.interval ?? 'monthly'}`
        : (this.resolvePriceId(body.plan, body.interval) ?? undefined);
    }
    if (!priceId) {
      throw new BadRequestException('Missing priceId or plan+interval');
    }
    // Only the plans Eneles sells can be bought: any other price in the Stripe
    // account would charge the person and then map to no plan at all.
    if (!stubbed) {
      if (!this.planForPrice(priceId)) {
        throw new BadRequestException('Unknown plan or price');
      }
    }
    if (stubbed && body.plan && !['pro', 'team'].includes(body.plan)) {
      throw new BadRequestException(`Unknown plan: ${body.plan}`);
    }

    const subscription = await this.initializeCustomer(userId);

    const successUrl = `${siteUrls().frontend}/billing?success=true`;

    if (stubbed) {
      // No Stripe: treat checkout as paid. Apply the plan now, so the dev
      // instance behaves exactly as it would after a real successful payment.
      const periodEnd = new Date();
      periodEnd.setMonth(periodEnd.getMonth() + 1);
      await this.prisma.client.$transaction([
        this.prisma.client.subscription.update({
          where: { id: subscription.id },
          data: {
            stripeSubscriptionId: `sub_dev_${userId}`,
            stripePriceId: priceId,
            stripeCurrentPeriodEnd: periodEnd,
            status: 'active',
            cancelAtPeriodEnd: false,
          },
        }),
        this.prisma.client.user.update({
          where: { id: userId },
          data: { subscriptionType: (body.plan as any) ?? 'pro' },
        }),
      ]);
      return { sessionId: `cs_dev_${userId}`, url: successUrl };
    }

    const session = await this.stripeService.createCheckoutSession(
      subscription.stripeCustomerId,
      priceId,
      successUrl,
      `${siteUrls().frontend}/billing?canceled=true`,
    );

    return { sessionId: session.id, url: session.url };
  }

  // Create billing portal session
  async createPortalSession(userId: number) {
    if (!this.plansActive && !(await this.paysThroughStripe(userId))) throw new ServiceUnavailableException(PLANS_PAUSED);
    const subscription = await this.initializeCustomer(userId);
    const returnUrl = `${siteUrls().frontend}/billing`;

    if (this.stripeService.isStubbed) {
      return { url: returnUrl };
    }

    const session = await this.stripeService.createBillingPortalSession(
      subscription.stripeCustomerId,
      returnUrl,
    );

    return { url: session.url };
  }

  // Get payment methods
  async getPaymentMethods(userId: number) {
    if (this.stripeService.isStubbed) return [];
    if (!this.plansActive && !(await this.paysThroughStripe(userId))) return [];
    const subscription = await this.initializeCustomer(userId);

    const paymentMethods = await this.stripeService.getPaymentMethods(
      subscription.stripeCustomerId,
    );

    return paymentMethods.data;
  }

  // Get invoices
  async getInvoices(userId: number) {
    if (this.stripeService.isStubbed) return [];
    if (!this.plansActive && !(await this.paysThroughStripe(userId))) return [];
    const subscription = await this.initializeCustomer(userId);

    const invoices = await this.stripeService.getInvoices(
      subscription.stripeCustomerId,
      100,
    );

    return invoices.data;
  }

  // Get payment history
  async getPaymentHistory(userId: number) {
    const payments = await this.prisma.client.payment.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return payments;
  }

  // Cancel subscription
  async cancelSubscription(userId: number, immediate = false) {
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user?.subscription?.stripeSubscriptionId) {
      throw new BadRequestException('No active subscription found');
    }

    if (!this.stripeService.isStubbed) {
      await this.stripeService.cancelSubscription(
        user.subscription.stripeSubscriptionId,
        !immediate,
      );
    } else if (immediate) {
      await this.prisma.client.user.update({
        where: { id: userId },
        data: { subscriptionType: 'free' },
      });
    }

    await this.prisma.client.subscription.update({
      where: { id: user.subscription.id },
      data: {
        cancelAtPeriodEnd: !immediate,
        status: immediate ? 'canceled' : 'active',
      },
    });

    return { message: 'Subscription canceled successfully' };
  }

  /**
   * Stop charging someone who is deleting their account: the subscription ends now, not at the period's end. If Stripe cannot be reached the deletion is refused, because deleting the account while the card keeps being charged is the one outcome nobody can fix from inside the app afterwards.
   */
  async endForDeletedAccount(userId: number): Promise<void> {
    const record = await this.prisma.client.subscription.findUnique({ where: { userId } });
    if (!record?.stripeSubscriptionId || record.status === 'canceled') return;
    if (!this.stripeService.isStubbed) {
      try {
        await this.stripeService.cancelSubscription(record.stripeSubscriptionId, false);
      } catch (err: any) {
        // Already gone on Stripe's side is the result we wanted.
        if (err?.code !== 'resource_missing') {
          throw new ConflictException('Your subscription could not be canceled, so the account was not deleted. Try again in a minute, or cancel the subscription on the Billing page first.');
        }
      }
    }
    await this.prisma.client.subscription.update({ where: { id: record.id }, data: { status: 'canceled', cancelAtPeriodEnd: false } });
  }

  // Reactivate subscription
  async reactivateSubscription(userId: number) {
    // Restarting a canceled plan starts charging again: that is buying.
    this.assertPlansActive();
    const user = await this.prisma.client.user.findUnique({
      where: { id: userId },
      include: { subscription: true },
    });

    if (!user?.subscription?.stripeSubscriptionId) {
      throw new BadRequestException('No subscription found');
    }

    if (!this.stripeService.isStubbed) {
      await this.stripeService.updateSubscription(
        user.subscription.stripeSubscriptionId,
        { cancel_at_period_end: false },
      );
    }

    await this.prisma.client.subscription.update({
      where: { id: user.subscription.id },
      data: {
        cancelAtPeriodEnd: false,
        status: 'active',
      },
    });

    return { message: 'Subscription reactivated successfully' };
  }

  // Handle Stripe webhook
  async handleWebhook(event: any) {
    switch (event.type) {
      // Checkout finished: the subscription exists now. Stripe also sends customer.subscription.created, but in no guaranteed order, so both lead to the same place.
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.mode === 'subscription' && session.subscription) {
          const id = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
          await this.applySubscription(await this.stripeService.getSubscription(id));
        }
        break;
      }

      case 'customer.subscription.created':
      case 'customer.subscription.updated':
        await this.applySubscription(event.data.object);
        break;

      case 'customer.subscription.deleted':
        await this.handleSubscriptionDeleted(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        await this.handlePaymentSucceeded(event.data.object);
        break;

      case 'invoice.payment_failed':
        await this.handlePaymentFailed(event.data.object);
        break;
    }
  }

  /**
   * Make our record match a Stripe subscription, and give or take the plan accordingly.
   *
   * The row is found by the subscription's id, or, for a subscription we have not seen yet (the first event after checkout), by its customer: the customer id is the one thing stored before any payment happens.
   */
  private async applySubscription(subscription: any) {
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.id;
    const record =
      (await this.prisma.client.subscription.findUnique({ where: { stripeSubscriptionId: subscription.id } })) ??
      (customerId ? await this.prisma.client.subscription.findUnique({ where: { stripeCustomerId: customerId } }) : null);
    if (!record) return;

    // An event about an older subscription must not overwrite the one that replaced it.
    const live = ['active', 'trialing', 'past_due'].includes(subscription.status);
    if (record.stripeSubscriptionId && record.stripeSubscriptionId !== subscription.id && !live) return;

    const item = subscription.items?.data?.[0];
    const priceId: string | undefined = item?.price?.id;
    // Newer Stripe API versions report the period on the item, older ones on the subscription.
    const periodEnd = subscription.current_period_end ?? item?.current_period_end;

    await this.prisma.client.subscription.update({
      where: { id: record.id },
      data: {
        stripeSubscriptionId: subscription.id,
        status: this.statusFor(subscription.status),
        stripePriceId: priceId ?? null,
        stripeCurrentPeriodEnd: typeof periodEnd === 'number' ? new Date(periodEnd * 1000) : null,
        cancelAtPeriodEnd: !!subscription.cancel_at_period_end,
      },
    });

    // Paid, or in its trial: the plan the price buys. Late on a payment: unchanged, while Stripe retries the card. Anything else (never paid, canceled, unpaid after the retries): free.
    if (subscription.status === 'past_due') return;
    const plan = live ? (this.planForPrice(priceId ?? '') ?? 'free') : 'free';
    await this.prisma.client.user.update({
      where: { id: record.userId },
      data: { subscriptionType: plan as any },
    });
  }

  /** Stripe has more states than we store. */
  private statusFor(status: string): 'active' | 'canceled' | 'past_due' | 'incomplete' | 'trialing' {
    switch (status) {
      case 'active':
      case 'trialing':
      case 'past_due':
      case 'incomplete':
        return status;
      case 'unpaid':
        return 'past_due';
      default:
        // canceled, incomplete_expired, paused
        return 'canceled';
    }
  }

  private async handleSubscriptionDeleted(subscription: any) {
    const record = await this.prisma.client.subscription.findUnique({
      where: { stripeSubscriptionId: subscription.id },
    });
    // Only the subscription on record ends the plan: one that was replaced has nothing left to take away.
    if (!record) return;

    await this.prisma.client.subscription.update({
      where: { id: record.id },
      data: { status: 'canceled', cancelAtPeriodEnd: false },
    });

    await this.prisma.client.user.update({
      where: { id: record.userId },
      data: { subscriptionType: 'free' },
    });
  }

  private async handlePaymentSucceeded(invoice: any) {
    const subscription = await this.prisma.client.subscription.findUnique({
      where: { stripeCustomerId: invoice.customer },
    });

    if (!subscription) return;

    // payment_intent can be null for $0 invoices (e.g. 100% coupon, trial start)
    if (!invoice.payment_intent) return;

    await this.prisma.client.payment.upsert({
      where: { stripePaymentId: invoice.payment_intent },
      create: {
        userId: subscription.userId,
        stripePaymentId: invoice.payment_intent,
        amount: invoice.amount_paid,
        currency: invoice.currency,
        status: 'succeeded',
        description:
          invoice.lines.data[0]?.description || 'Subscription payment',
        receiptUrl: invoice.hosted_invoice_url,
      },
      update: {}, // Already exists (Stripe retry), skip silently
    });
  }

  private async handlePaymentFailed(invoice: any) {
    const subscription = await this.prisma.client.subscription.findUnique({
      where: { stripeCustomerId: invoice.customer },
    });

    if (!subscription) return;

    await this.prisma.client.subscription.update({
      where: { id: subscription.id },
      data: { status: 'past_due' },
    });
  }
}
