import { BillingService } from './billing.service';

/** Price ids come from either spelling of the variable name. */
describe('BillingService price lookup', () => {
  const make = (env: Record<string, string>) =>
    new BillingService({} as any, {} as any, { get: (k: string) => env[k] } as any) as any;

  it('reads the names the env files use', () => {
    const billing = make({ STRIPE_PRO_MONTHLY_PRICE_ID: 'price_pm', STRIPE_TEAM_YEARLY_PRICE_ID: 'price_ty' });
    expect(billing.resolvePriceId('pro', 'monthly')).toBe('price_pm');
    expect(billing.resolvePriceId('team', 'annual')).toBe('price_ty');
    expect(billing.planForPrice('price_ty')).toBe('team');
  });

  it('reads the names .env.example uses', () => {
    const billing = make({ STRIPE_PRICE_PRO_YEARLY: 'price_py', STRIPE_PRICE_ENTERPRISE_YEARLY: 'price_ey' });
    expect(billing.resolvePriceId('pro', 'yearly')).toBe('price_py');
    expect(billing.planForPrice('price_ey')).toBe('enterprise');
  });

  it('knows nothing of prices it does not sell', () => {
    const billing = make({ STRIPE_PRO_MONTHLY_PRICE_ID: 'price_pm' });
    expect(billing.planForPrice('price_other')).toBeNull();
    expect(billing.planForPrice(undefined)).toBeNull();
    expect(billing.resolvePriceId('enterprise', 'monthly')).toBeNull();
  });
});

/** What Stripe's webhooks do to an account. The database is a pair of in-memory rows; Stripe is never contacted. */
describe('BillingService webhooks', () => {
  const ENV = { STRIPE_PRO_MONTHLY_PRICE_ID: 'price_pro', STRIPE_TEAM_MONTHLY_PRICE_ID: 'price_team' };

  function setup(record: Record<string, unknown> = {}) {
    // After checkout starts and before anything is paid, this is all we hold: the customer id.
    const row: Record<string, any> = { id: 1, userId: 9, stripeCustomerId: 'cus_1', stripeSubscriptionId: null, status: 'active', ...record };
    const user: Record<string, any> = { id: 9, subscriptionType: 'free' };
    const prisma = {
      client: {
        subscription: {
          findUnique: jest.fn(async ({ where }: any) => {
            if (where.stripeSubscriptionId !== undefined) return where.stripeSubscriptionId === row.stripeSubscriptionId ? { ...row } : null;
            if (where.stripeCustomerId !== undefined) return where.stripeCustomerId === row.stripeCustomerId ? { ...row } : null;
            if (where.userId !== undefined) return where.userId === row.userId ? { ...row } : null;
            return null;
          }),
          update: jest.fn(async ({ data }: any) => Object.assign(row, data)),
        },
        user: { update: jest.fn(async ({ data }: any) => Object.assign(user, data)) },
        payment: { upsert: jest.fn() },
      },
    };
    const stripe = { isStubbed: false, getSubscription: jest.fn(), cancelSubscription: jest.fn() };
    const billing = new BillingService(prisma as any, stripe as any, { get: (k: string) => (ENV as Record<string, string>)[k] } as any);
    return { billing, row, user, stripe };
  }

  const subscription = (over: Record<string, unknown> = {}) => ({
    id: 'sub_1',
    customer: 'cus_1',
    status: 'active',
    cancel_at_period_end: false,
    current_period_end: 1_800_000_000,
    items: { data: [{ price: { id: 'price_pro' } }] },
    ...over,
  });

  it('activates the plan on the first subscription event, found by the customer', async () => {
    const { billing, row, user } = setup();
    await billing.handleWebhook({ type: 'customer.subscription.created', data: { object: subscription() } });
    expect(user.subscriptionType).toBe('pro');
    expect(row.stripeSubscriptionId).toBe('sub_1');
    expect(row.stripePriceId).toBe('price_pro');
    expect(row.stripeCurrentPeriodEnd).toEqual(new Date(1_800_000_000 * 1000));
  });

  it('activates the plan when checkout completes, whichever event arrives first', async () => {
    const { billing, user, stripe } = setup();
    stripe.getSubscription.mockResolvedValue(subscription({ items: { data: [{ price: { id: 'price_team' }, current_period_end: 1_800_000_000 }] }, current_period_end: undefined }));
    await billing.handleWebhook({ type: 'checkout.session.completed', data: { object: { mode: 'subscription', subscription: 'sub_1' } } });
    expect(stripe.getSubscription).toHaveBeenCalledWith('sub_1');
    expect(user.subscriptionType).toBe('team');
  });

  it('reads the period from the item, where newer Stripe API versions put it', async () => {
    const { billing, row } = setup();
    await billing.handleWebhook({ type: 'customer.subscription.updated', data: { object: subscription({ current_period_end: undefined, items: { data: [{ price: { id: 'price_pro' }, current_period_end: 1_700_000_000 }] } }) } });
    expect(row.stripeCurrentPeriodEnd).toEqual(new Date(1_700_000_000 * 1000));
  });

  it('gives no plan for a subscription that was never paid', async () => {
    const { billing, user, row } = setup();
    await billing.handleWebhook({ type: 'customer.subscription.created', data: { object: subscription({ status: 'incomplete' }) } });
    expect(user.subscriptionType).toBe('free');
    expect(row.status).toBe('incomplete');
  });

  it('keeps the plan while a payment is late, and takes it when Stripe gives up', async () => {
    const { billing, user, row } = setup({ stripeSubscriptionId: 'sub_1' });
    user.subscriptionType = 'pro';
    await billing.handleWebhook({ type: 'customer.subscription.updated', data: { object: subscription({ status: 'past_due' }) } });
    expect(user.subscriptionType).toBe('pro');
    expect(row.status).toBe('past_due');
    await billing.handleWebhook({ type: 'customer.subscription.updated', data: { object: subscription({ status: 'unpaid' }) } });
    expect(user.subscriptionType).toBe('free');
  });

  it('follows a change of plan', async () => {
    const { billing, user } = setup({ stripeSubscriptionId: 'sub_1' });
    user.subscriptionType = 'pro';
    await billing.handleWebhook({ type: 'customer.subscription.updated', data: { object: subscription({ items: { data: [{ price: { id: 'price_team' } }] } }) } });
    expect(user.subscriptionType).toBe('team');
  });

  it('returns the account to free when the subscription ends', async () => {
    const { billing, user, row } = setup({ stripeSubscriptionId: 'sub_1' });
    user.subscriptionType = 'pro';
    await billing.handleWebhook({ type: 'customer.subscription.deleted', data: { object: subscription({ status: 'canceled' }) } });
    expect(user.subscriptionType).toBe('free');
    expect(row.status).toBe('canceled');
  });

  it('ignores the end of a subscription that has since been replaced', async () => {
    const { billing, user, row } = setup({ stripeSubscriptionId: 'sub_2' });
    user.subscriptionType = 'pro';
    await billing.handleWebhook({ type: 'customer.subscription.deleted', data: { object: subscription({ id: 'sub_1', status: 'canceled' }) } });
    await billing.handleWebhook({ type: 'customer.subscription.updated', data: { object: subscription({ id: 'sub_1', status: 'canceled' }) } });
    expect(user.subscriptionType).toBe('pro');
    expect(row.stripeSubscriptionId).toBe('sub_2');
  });

  it('cancels at Stripe when the account is deleted, and refuses the deletion if it cannot', async () => {
    const ok = setup({ stripeSubscriptionId: 'sub_1' });
    await ok.billing.endForDeletedAccount(9);
    expect(ok.stripe.cancelSubscription).toHaveBeenCalledWith('sub_1', false);
    expect(ok.row.status).toBe('canceled');

    const down = setup({ stripeSubscriptionId: 'sub_1' });
    down.stripe.cancelSubscription.mockRejectedValue(new Error('network'));
    await expect(down.billing.endForDeletedAccount(9)).rejects.toThrow(/not deleted/);
    expect(down.row.status).toBe('active');

    const none = setup();
    await none.billing.endForDeletedAccount(9);
    expect(none.stripe.cancelSubscription).not.toHaveBeenCalled();
  });
});

/** Paid plans are sold only when BILLING_PLANS_ACTIVE says so, and never with a test key in production; nothing can be bought or restarted otherwise, stubbed or not. */
describe('BillingService while plans are paused', () => {
  const config = (env: Record<string, string>) => ({ get: (k: string, fallback?: string) => env[k] ?? fallback }) as any;
  const prisma = (record: Record<string, unknown> | null = null) => {
    const client = {
      user: { findUnique: jest.fn(async () => ({ id: 9, subscriptionType: 'free', subscription: record })), update: jest.fn() },
      subscription: { findUnique: jest.fn(async () => record), create: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    };
    return { client } as any;
  };
  const stripe = (stubbed: boolean) => ({ isStubbed: stubbed, createCustomer: jest.fn(), createCheckoutSession: jest.fn(), createBillingPortalSession: jest.fn(), updateSubscription: jest.fn(), getPaymentMethods: jest.fn(), getInvoices: jest.fn() }) as any;

  it('is off unless the variable is exactly true', () => {
    const { plansActive } = jest.requireActual('../common/billing');
    expect(plansActive(config({}))).toBe(false);
    expect(plansActive(config({ BILLING_PLANS_ACTIVE: 'false' }))).toBe(false);
    expect(plansActive(config({ BILLING_PLANS_ACTIVE: '1' }))).toBe(false);
    expect(plansActive(config({ BILLING_PLANS_ACTIVE: 'true' }))).toBe(false);
  });

  it('never sells with a test key in production', () => {
    const { plansActive } = jest.requireActual('../common/billing');
    expect(plansActive(config({ BILLING_PLANS_ACTIVE: 'true', NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_x' }))).toBe(false);
    expect(plansActive(config({ BILLING_PLANS_ACTIVE: 'true', NODE_ENV: 'production', STRIPE_SECRET_KEY: 'rk_test_x' }))).toBe(false);
    expect(plansActive(config({ BILLING_PLANS_ACTIVE: 'true', NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_live_x' }))).toBe(false);
  });

  it('refuses checkout, even stubbed, and changes nothing', async () => {
    const db = prisma();
    const s = stripe(true);
    const billing = new BillingService(db, s, config({ NODE_ENV: 'development' }));
    await expect(billing.createCheckoutSession(9, { plan: 'pro' })).rejects.toThrow('Paid plans are not available yet');
    expect(db.client.user.update).not.toHaveBeenCalled();
    expect(db.client.$transaction).not.toHaveBeenCalled();
    expect(s.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('refuses restarting a canceled plan', async () => {
    const db = prisma({ id: 1, stripeSubscriptionId: 'sub_1' });
    const billing = new BillingService(db, stripe(false), config({ NODE_ENV: 'production' }));
    await expect(billing.reactivateSubscription(9)).rejects.toThrow('Paid plans are not available yet');
    expect(db.client.subscription.update).not.toHaveBeenCalled();
  });

  it('opens no portal and makes no Stripe customer for someone who never paid', async () => {
    const db = prisma();
    const s = stripe(false);
    const billing = new BillingService(db, s, config({ NODE_ENV: 'production' }));
    await expect(billing.createPortalSession(9)).rejects.toThrow('Paid plans are not available yet');
    expect(await billing.getPaymentMethods(9)).toEqual([]);
    expect(await billing.getSubscription(9)).toMatchObject({ subscriptionType: 'free', plansActive: false });
    expect(s.createCustomer).not.toHaveBeenCalled();
    expect(db.client.subscription.create).not.toHaveBeenCalled();
  });

  it('still lets someone who pays manage their plan', async () => {
    const db = prisma({ id: 1, userId: 9, stripeCustomerId: 'cus_1', stripeSubscriptionId: 'sub_1' });
    const s = stripe(false);
    s.createBillingPortalSession.mockResolvedValue({ url: 'https://billing.stripe.com/x' });
    const billing = new BillingService(db, s, config({ NODE_ENV: 'production' }));
    expect(await billing.createPortalSession(9)).toEqual({ url: 'https://billing.stripe.com/x' });
  });
});

/** The local stand-in for Stripe only exists where NODE_ENV says development or test: a server with NODE_ENV unset must not hand out plans. */
describe('StripeService stub', () => {
  const { StripeService } = jest.requireActual('./stripe.service');
  const make = (env: Record<string, string>) => {
    const service = new StripeService({ get: (k: string) => env[k] } as any);
    service.onModuleInit();
    return service;
  };
  it('is off when NODE_ENV is unset or production', () => {
    expect(make({}).isStubbed).toBe(false);
    expect(make({ NODE_ENV: 'production' }).isStubbed).toBe(false);
    expect(make({ NODE_ENV: 'staging' }).isStubbed).toBe(false);
  });
  it('is on in development and test without a key', () => {
    expect(make({ NODE_ENV: 'development' }).isStubbed).toBe(true);
    expect(make({ NODE_ENV: 'test' }).isStubbed).toBe(true);
  });
});
