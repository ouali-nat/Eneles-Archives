import type { CookieOptions, Response } from 'express';
import { isAllowedOrigin } from './cors';

/**
 * The browser keeps its sign-in in this cookie. It is HttpOnly, so page
 * scripts (and anything injected into a page) cannot read it; before, the
 * token sat in localStorage and in a script-readable cookie.
 *
 * Programs still authenticate with `Authorization: Bearer` or `x-api-key`.
 */
export const SESSION_COOKIE = 'texer_session';

/** Matches the session lifetime in AuthService and the default JWT_EXPIRATION. */
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

type HeaderBag = Record<string, string | string[] | undefined>;

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    // Browsers drop Secure cookies on plain-HTTP origins, which local
    // development uses, so it is tied to production.
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    // Host-only by default: only the API host ever sees the cookie.
    domain: process.env.SESSION_COOKIE_DOMAIN?.trim() || undefined,
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: SESSION_MAX_AGE_MS });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export function readCookie(header: string | string[] | undefined, name: string): string | undefined {
  if (typeof header !== 'string') return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim()) || undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface RequestToken {
  token: string;
  via: 'header' | 'cookie';
}

/** An explicit Authorization header wins over the cookie. */
export function tokenFromHeaders(headers: HeaderBag): RequestToken | null {
  const auth = headers['authorization'];
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice(7).trim();
    if (token) return { token, via: 'header' };
  }
  const token = readCookie(headers['cookie'], SESSION_COOKIE);
  return token ? { token, via: 'cookie' } : null;
}

/**
 * A browser attaches the cookie to requests that other sites trigger, too.
 * A request that changes something and is authenticated only by the cookie
 * must therefore come from one of our own origins. Browsers always send
 * Origin on the cross-origin requests the site makes to the API.
 */
export function cookieRequestAllowed(method: string, headers: HeaderBag): boolean {
  if (SAFE_METHODS.has(method.toUpperCase())) return true;
  return hasOwnOrigin(headers);
}

/** Origin is present and is one of ours. */
export function hasOwnOrigin(headers: HeaderBag): boolean {
  const origin = headers['origin'];
  return typeof origin === 'string' && origin.length > 0 && isAllowedOrigin(origin);
}
