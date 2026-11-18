/**
 * Per-person rate limits for the assistant, counted in memory on this server: a fixed number of events in a sliding window. The global throttler counts by address, which a whole office or campus shares; these count by account, so one person cannot run up a provider bill (theirs or the platform's) or hammer a provider with key checks.
 */
export class UserRateLimit {
  private readonly hits = new Map<number, number[]>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
  ) {}

  /** Records one event for `userId` and says whether it is allowed; when it is not, how many seconds until it would be. */
  take(
    userId: number,
    now = Date.now(),
  ): { ok: true } | { ok: false; retryAfter: number } {
    const since = now - this.windowMs;
    const recent = (this.hits.get(userId) ?? []).filter((t) => t > since);
    if (recent.length >= this.limit) {
      this.hits.set(userId, recent);
      return {
        ok: false,
        retryAfter: Math.max(
          1,
          Math.ceil((recent[0] + this.windowMs - now) / 1000),
        ),
      };
    }
    recent.push(now);
    this.hits.set(userId, recent);
    // Keep the map from growing without bound on a long-lived server.
    if (this.hits.size > 10_000)
      for (const [id, times] of this.hits)
        if (!times.some((t) => t > since)) this.hits.delete(id);
    return { ok: true };
  }
}

/** Assistant messages: 20 a minute and 300 an hour for each person. */
export const CHAT_PER_MINUTE = new UserRateLimit(20, 60_000);
export const CHAT_PER_HOUR = new UserRateLimit(300, 3_600_000);
/** Saving and checking a key (each check is a call to the provider): 10 in ten minutes. */
export const KEY_CHECKS = new UserRateLimit(10, 600_000);
/** Refreshing a model list from the provider: 30 in ten minutes. */
export const MODEL_LISTS = new UserRateLimit(30, 600_000);
