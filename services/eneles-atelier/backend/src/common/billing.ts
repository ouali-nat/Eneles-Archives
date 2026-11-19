import type { ConfigService } from '@nestjs/config';

/**
 * Eneles exposes one free access level. Paid subscriptions and Stripe checkout are intentionally disabled; product access does not depend on subscription state.
 */
export function plansActive(_config: ConfigService): boolean {
  // Eneles has no paid subscription tiers. Checkout is deliberately closed.
  return false;
}

/** A Stripe test-mode key (secret or restricted). */
export function isTestKey(key: string | undefined): boolean {
  return !!key && /^(sk|rk)_test_/.test(key.trim());
}

/** Message returned if a legacy client attempts to open subscription checkout. */
export const PLANS_PAUSED =
  'Eneles does not sell subscriptions. All product features are available without a paid plan.';
