import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { isTestKey, plansActive } from '../common/billing';

@Injectable()
export class StripeService implements OnModuleInit {
  /**
   * Null when STRIPE_SECRET_KEY is unset. Billing then fails per request with
   * a clear error instead of taking the whole application down at boot, so a
   * dev instance without Stripe can still serve everything else.
   */
  private client: Stripe | null = null;
  private readonly logger = new Logger(StripeService.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit() {
    const apiKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    const wanted = this.configService.get<string>('BILLING_PLANS_ACTIVE')?.trim().toLowerCase() === 'true';
    if (!plansActive(this.configService)) {
      this.logger.warn(
        wanted && isTestKey(apiKey)
          ? 'BILLING_PLANS_ACTIVE is true, but STRIPE_SECRET_KEY is a test key on a production server. Paid plans stay paused until it is a live key.'
          : 'Paid plans are paused (BILLING_PLANS_ACTIVE is not "true"): nothing can be bought.',
      );
    }
    if (!apiKey) {
      this.logger.warn(
        this.isStubbedEnv()
          ? 'STRIPE_SECRET_KEY is not defined. Billing is stubbed: every call succeeds locally, nothing reaches Stripe.'
          : 'STRIPE_SECRET_KEY is not defined. Billing will not work.',
      );
      return;
    }
    this.client = new Stripe(apiKey, {
      apiVersion: '2026-02-25.clover',
    });
  }

  private get stripe(): Stripe {
    if (!this.client) {
      throw new Error(
        'Billing is not configured: STRIPE_SECRET_KEY is not set on this server',
      );
    }
    return this.client;
  }

  /** True when there is no Stripe key and NODE_ENV says, in so many words, development or test. BillingService then answers every call locally as if payment had succeeded, so a dev instance works end to end without a Stripe account. A server whose NODE_ENV is unset or anything else is never stubbed (a stub there would hand out plans for nothing), and the moment a key is set the real integration is used. Buying, stubbed or not, also needs plans to be on sale (common/billing). */
  get isStubbed(): boolean {
    return this.client === null && this.isStubbedEnv();
  }

  private isStubbedEnv(): boolean {
    const env = this.configService.get<string>('NODE_ENV');
    return env === 'development' || env === 'test';
  }

  getStripeInstance(): Stripe {
    return this.stripe;
  }

  // Customer Management
  async createCustomer(email: string, name: string) {
    return this.stripe.customers.create({
      email,
      name,
    });
  }

  async getCustomer(customerId: string) {
    return this.stripe.customers.retrieve(customerId);
  }

  async updateCustomer(customerId: string, data: Stripe.CustomerUpdateParams) {
    return this.stripe.customers.update(customerId, data);
  }

  // Subscription Management
  async createSubscription(customerId: string, priceId: string) {
    return this.stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: 'default_incomplete',
      payment_settings: { save_default_payment_method: 'on_subscription' },
      expand: ['latest_invoice.payment_intent'],
    });
  }

  async getSubscription(subscriptionId: string) {
    return this.stripe.subscriptions.retrieve(subscriptionId);
  }

  async updateSubscription(
    subscriptionId: string,
    data: Stripe.SubscriptionUpdateParams,
  ) {
    return this.stripe.subscriptions.update(subscriptionId, data);
  }

  async cancelSubscription(subscriptionId: string, cancelAtPeriodEnd = true) {
    if (cancelAtPeriodEnd) {
      return this.stripe.subscriptions.update(subscriptionId, {
        cancel_at_period_end: true,
      });
    } else {
      return this.stripe.subscriptions.cancel(subscriptionId);
    }
  }

  // Payment Methods
  async getPaymentMethods(customerId: string) {
    return this.stripe.paymentMethods.list({
      customer: customerId,
      type: 'card',
    });
  }

  async attachPaymentMethod(paymentMethodId: string, customerId: string) {
    return this.stripe.paymentMethods.attach(paymentMethodId, {
      customer: customerId,
    });
  }

  async detachPaymentMethod(paymentMethodId: string) {
    return this.stripe.paymentMethods.detach(paymentMethodId);
  }

  async setDefaultPaymentMethod(customerId: string, paymentMethodId: string) {
    return this.stripe.customers.update(customerId, {
      invoice_settings: {
        default_payment_method: paymentMethodId,
      },
    });
  }

  // Invoices
  async getInvoices(customerId: string, limit = 10) {
    return this.stripe.invoices.list({
      customer: customerId,
      limit,
    });
  }

  async getUpcomingInvoice(customerId: string) {
    return (this.stripe.invoices as any).upcoming({
      customer: customerId,
    });
  }

  // Checkout Session
  async createCheckoutSession(
    customerId: string,
    priceId: string,
    successUrl: string,
    cancelUrl: string,
  ) {
    return this.stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      mode: 'subscription',
      success_url: successUrl,
      cancel_url: cancelUrl,
    });
  }

  // Billing Portal
  async createBillingPortalSession(customerId: string, returnUrl: string) {
    return this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
  }

  // Webhook handling
  constructWebhookEvent(payload: Buffer, signature: string) {
    const webhookSecret = this.configService.get<string>(
      'STRIPE_WEBHOOK_SECRET',
    );
    if (!webhookSecret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is not defined');
    }
    return this.stripe.webhooks.constructEvent(
      payload,
      signature,
      webhookSecret,
    );
  }
}
