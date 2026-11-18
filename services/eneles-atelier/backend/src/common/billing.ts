import type { ConfigService } from '@nestjs/config';

/**
 * Whether paid plans are on sale. Off unless `BILLING_PLANS_ACTIVE` is exactly "true", so a server that forgets the variable sells nothing and charges nobody: checkout, restarting a canceled plan, and the local stand-in for Stripe are all closed, while people who already pay can still see and cancel what they have. A production server also refuses to sell with Stripe's test keys, since anyone could pay with a test card and get a plan for nothing.
 */
export function plansActive(_config: ConfigService): boolean {
  // Eneles has no paid subscription tiers. Checkout is deliberately closed.
  return false;
}

/** A Stripe test-mode key (secret or restricted). */
export function isTestKey(key: string | undefined): boolean {
  return !!key && /^(sk|rk)_test_/.test(key.trim());
}

/** What someone is told when they try to buy while plans are paused. */
export const PLANS_PAUSED =
  'Eneles does not sell subscriptions. All product features are available without a paid plan.';
