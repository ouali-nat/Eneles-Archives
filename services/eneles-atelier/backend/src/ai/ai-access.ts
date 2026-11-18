import {
  LOCAL_PROVIDER,
  PLATFORM_PROVIDER,
  PROVIDER_IDS,
  isProviderId,
  type ProviderId,
} from './ai-providers';

/**
 * Who pays for an assistant request, decided in one pure function so the rule is written once and tested.
 *
 * - The person's own key, for the provider they chose, always comes first.
 * - Platform AI is the operators' switch. Off (the default), the assistant works only with the person's own key, on every plan. On, people whose plan includes the assistant may also use the platform's keys when they have none of their own (and the platform has keys set).
 * - The local test model answers from a script with no model call. It exists only outside production, and only when chosen.
 */

export interface AccessInput {
  /** The provider asked for: one of the providers, "platform", "local", or nothing (use the default). */
  requested?: string | null;
  /** The account's default provider, from its preferences. */
  preferred?: string | null;
  /** Providers the person has a key for. */
  keys: ReadonlySet<ProviderId>;
  platformEnabled: boolean;
  /** The operators have set a platform key, so the platform path can answer. */
  platformConfigured: boolean;
  planIncludesAssistant: boolean;
  production: boolean;
}

export type AccessDecision =
  | { ok: true; source: 'own'; provider: ProviderId }
  | { ok: true; source: 'platform'; provider: typeof PLATFORM_PROVIDER }
  | { ok: true; source: 'local'; provider: typeof LOCAL_PROVIDER }
  | {
      ok: false;
      /** no_key: nothing can answer; the person adds a key (or, when `upgrade`, subscribes). */
      reason: 'no_key';
      /** Platform AI is on and the plan lacks it: Upgrade is offered beside Add an API key. */
      upgrade: boolean;
    };

export function platformAvailable(
  input: Pick<
    AccessInput,
    'platformEnabled' | 'platformConfigured' | 'planIncludesAssistant'
  >,
): boolean {
  return (
    input.platformEnabled &&
    input.platformConfigured &&
    input.planIncludesAssistant
  );
}

export function decideAccess(input: AccessInput): AccessDecision {
  const { requested, preferred, keys, production } = input;
  const platform = platformAvailable(input);

  if (requested === LOCAL_PROVIDER && !production)
    return { ok: true, source: 'local', provider: LOCAL_PROVIDER };
  if (isProviderId(requested) && keys.has(requested))
    return { ok: true, source: 'own', provider: requested };
  if (requested === PLATFORM_PROVIDER && platform)
    return { ok: true, source: 'platform', provider: PLATFORM_PROVIDER };

  // Nothing asked for, or what was asked for cannot answer: the account's default, then any key of its own, then the platform.
  if (isProviderId(preferred) && keys.has(preferred))
    return { ok: true, source: 'own', provider: preferred };
  if (preferred === LOCAL_PROVIDER && !production && !keys.size && !platform)
    return { ok: true, source: 'local', provider: LOCAL_PROVIDER };
  const own = PROVIDER_IDS.find((p) => keys.has(p));
  if (own) return { ok: true, source: 'own', provider: own };
  if (platform)
    return { ok: true, source: 'platform', provider: PLATFORM_PROVIDER };
  return {
    ok: false,
    reason: 'no_key',
    upgrade:
      input.platformEnabled &&
      input.platformConfigured &&
      !input.planIncludesAssistant,
  };
}
