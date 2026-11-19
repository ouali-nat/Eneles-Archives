/**
 * Where everything Eneles runs, worked out from one setting: the domain name (NEXT_PUBLIC_DOMAIN_NAME, for example eneles-atelier.up.railway.app).
 *
 *   the site   https://<domain>
 *   the API    https://api.<domain>
 *   the admin  https://admin.<domain>
 *
 * NEXT_PUBLIC_API_URL overrides the API's address, which is how a machine in development points at http://localhost:2161. With neither set, the API is assumed to be on localhost.
 *
 * The backend applies the same rule to DOMAIN_NAME (backend/src/common/site.ts).
 */
export const DOMAIN_NAME = (process.env.NEXT_PUBLIC_DOMAIN_NAME ?? "")
  .trim()
  .toLowerCase()
  .replace(/^https?:\/\//, "")
  .replace(/\/+$/, "");

const configuredApiUrl = (process.env.NEXT_PUBLIC_API_URL || (DOMAIN_NAME ? `https://api.${DOMAIN_NAME}` : "http://localhost:2161")).replace(/\/+$/, "");

/**
 * A page opened on a subdomain of localhost (admin.localhost:2160) reaches the API on that same name (admin.localhost:2161). Browsers count localhost and admin.localhost as different sites, so the sign-in cookie set by http://localhost:2161 is neither stored nor sent from a page on admin.localhost, and every request after signing in comes back 401. The same name on another port is the same site, and it reaches the same local server.
 */
function localSubdomainApiUrl(): string {
  if (typeof window === "undefined" || !window.location.hostname.endsWith(".localhost")) return configuredApiUrl;
  try {
    const url = new URL(configuredApiUrl);
    if (url.hostname !== "localhost") return configuredApiUrl;
    url.hostname = window.location.hostname;
    return url.origin;
  } catch {
    return configuredApiUrl;
  }
}

export const API_URL = localSubdomainApiUrl();

/** The public site, for canonical links and the sitemap. */
export const SITE_URL = DOMAIN_NAME ? `https://${DOMAIN_NAME}` : "https://aurore-section-archivescom.vercel.app";

/** The host the operators' panel is served at, or "" when no domain is set (development: the panel is at /admin). */
export const ADMIN_HOST = DOMAIN_NAME ? `admin.${DOMAIN_NAME}` : "";
