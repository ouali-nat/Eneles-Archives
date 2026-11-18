/**
 * Where everything Eneles runs, worked out from one setting: DOMAIN_NAME.
 *
 *   the site      https://<DOMAIN_NAME>
 *   the API       https://api.<DOMAIN_NAME>
 *   the admin     https://admin.<DOMAIN_NAME>
 *   the CDN       https://cdn.<DOMAIN_NAME>
 *   the compiler  https://compile.<DOMAIN_NAME>
 *
 * So production needs DOMAIN_NAME=texer.org and nothing else for addresses, and a development environment needs DOMAIN_NAME=dev.texer.org. Two addresses can be overridden, for the cases the rule cannot cover: a machine in development, where the site and the compiler are on localhost (FRONTEND_URL, COMPILER_URL), and a compiler reached over a private network (COMPILER_URL).
 *
 * Read at call time, not import time: the env files are loaded after some modules are imported.
 */
export interface SiteUrls {
  /** The bare domain, lower-cased, or "" when DOMAIN_NAME is unset. */
  domain: string;
  /** No trailing slash on any of these. "" means unknown. */
  frontend: string;
  api: string;
  admin: string;
  cdn: string;
  compiler: string;
}

const clean = (value: string | undefined): string => {
  let url = (value ?? '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `http://${url}`;
  return url.replace(/\/+$/, '');
};

export function siteUrls(env: NodeJS.ProcessEnv = process.env): SiteUrls {
  const domain = (env.DOMAIN_NAME ?? '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const on = (subdomain: string) => (domain ? `https://${subdomain}.${domain}` : '');
  return {
    domain,
    frontend: clean(env.FRONTEND_URL) || (domain ? `https://${domain}` : ''),
    api: on('api'),
    admin: on('admin'),
    cdn: on('cdn'),
    compiler: clean(env.COMPILER_URL) || on('compile'),
  };
}
