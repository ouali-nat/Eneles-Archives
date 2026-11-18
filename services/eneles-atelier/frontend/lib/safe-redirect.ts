/**
 * A post-sign-in destination taken from the address bar, kept on this site.
 * Checking for a leading "/" is not enough: browsers read "/\evil.example"
 * as "//evil.example". The value is resolved like a link would be, and only
 * a same-origin path survives.
 */
export function safeRedirect(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value || typeof window === "undefined") return fallback;
  try {
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
