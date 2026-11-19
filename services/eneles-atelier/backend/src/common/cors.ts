/**
 * CORS origin policy, derived from DOMAIN_NAME.
 *
 * Allowed: https on DOMAIN_NAME itself and any subdomain of it. So with
 * DOMAIN_NAME=eneles.example, the site, www, live, api, and cdn are all in; with
 * DOMAIN_NAME=dev.eneles.example, only dev and its subdomains are. Outside
 * production, http://localhost (and its subdomains, such as admin.localhost)
 * and http://127.0.0.1 on any port are allowed too. Requests with no Origin header (curl, server-to-server) pass through,
 * which is the standard behaviour of the cors library and what non-browser
 * clients need.
 *
 * Read at request time, not import time, because the gateway decorator is
 * evaluated before ConfigModule has loaded the env files into process.env.
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
  if (!origin) return true;

  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  const explicitOrigins = (process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim().replace(/\/$/, ''))
    .filter(Boolean);
  if (explicitOrigins.includes(url.origin)) return true;

  const isProduction = process.env.NODE_ENV === 'production';
  if (!isProduction && url.protocol === 'http:') {
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname.endsWith('.localhost')) {
      return true;
    }
  }

  const domain = (process.env.DOMAIN_NAME || '').trim().toLowerCase();
  if (!domain || url.protocol !== 'https:') return false;

  const host = url.hostname.toLowerCase();
  return host === domain || host.endsWith(`.${domain}`);
}

/** Shape expected by both Express cors and Socket.IO. */
export function corsOriginCallback(
  origin: string | undefined,
  callback: (err: Error | null, allow?: boolean) => void,
): void {
  callback(null, isAllowedOrigin(origin));
}
