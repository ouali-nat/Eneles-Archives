import { lookup as dnsLookup, type LookupAddress } from 'dns';
import { request as httpRequest } from 'http';
import { request as httpsRequest } from 'https';
import { isIP, type LookupFunction } from 'net';
import { Readable } from 'stream';

/**
 * Where the server may send a person's requests for the OpenAI-compatible provider. The person types the base URL, and the server then makes requests to it, so without these checks anyone could make the server call its own internal network (server-side request forgery): the cloud metadata service, the database, other services on the private network.
 *
 * - The URL must be https, with no user name or password in it. In development only, plain http is allowed to `localhost`, `127.0.0.1`, and `[::1]`, for a local model (Ollama, LM Studio).
 * - The host must resolve to public addresses only: private, loopback, link-local (which holds the metadata service), carrier-grade NAT, multicast, documentation, and reserved ranges are refused. The addresses are checked again at connect time by `guardedFetch`, every time, so a name that resolves to a public address when it is checked and to a private one later (DNS rebinding) is still refused.
 */

const LOCAL_NAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export type UrlCheck =
  { ok: true; url: string; local: boolean } | { ok: false; reason: string };

/** The URL as typed, checked for shape. `production` decides whether the local exception applies. Does not resolve the name; see `checkResolved`. */
export function checkBaseUrl(raw: unknown, production: boolean): UrlCheck {
  if (typeof raw !== 'string' || !raw.trim())
    return {
      ok: false,
      reason: 'Enter the base URL of the API, such as https://example.com/v1.',
    };
  if (raw.length > 300) return { ok: false, reason: 'That URL is too long.' };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return {
      ok: false,
      reason: 'That is not a URL. It looks like https://example.com/v1.',
    };
  }
  if (url.username || url.password)
    return {
      ok: false,
      reason:
        'Leave the user name and password out of the URL: the key goes in its own field.',
    };
  if (url.search || url.hash)
    return {
      ok: false,
      reason: 'Leave the query and fragment out of the base URL.',
    };
  const host = url.hostname.toLowerCase();
  const local = LOCAL_NAMES.has(host);
  if (local && production)
    return {
      ok: false,
      reason:
        'A model on this machine cannot be reached from the server. Use a public https address.',
    };
  if (
    url.protocol !== 'https:' &&
    !(url.protocol === 'http:' && local && !production)
  ) {
    return {
      ok: false,
      reason: production
        ? 'The base URL must start with https://.'
        : 'The base URL must start with https://, or http:// for localhost while developing.',
    };
  }
  if (!local) {
    const literal = host.replace(/^\[|\]$/g, '');
    if (isIP(literal) && blockedAddress(literal))
      return {
        ok: false,
        reason:
          'That address is on a private or reserved network, which the server does not call.',
      };
    if (
      host.endsWith('.internal') ||
      host.endsWith('.local') ||
      host.endsWith('.localhost') ||
      !host.includes('.')
    )
      return {
        ok: false,
        reason:
          'That host name is on a private network, which the server does not call.',
      };
  }
  const clean = `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  return { ok: true, url: clean, local };
}

const v4 = (a: string) => a.split('.').map(Number);
const inV4 = (parts: number[], base: string, bits: number) => {
  const b = v4(base);
  const value = (p: number[]) =>
    ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (value(parts) & mask) >>> 0 === (value(b) & mask) >>> 0;
};

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

/** Expands an IPv6 address to its eight 16-bit groups. */
function v6Groups(address: string): number[] | null {
  let a = address.toLowerCase().split('%')[0];
  // An embedded IPv4 tail (::ffff:10.0.0.1) becomes two groups.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (tail) {
    const p = v4(tail[1]);
    a =
      a.slice(0, -tail[1].length) +
      `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  const [head, rest] = a.split('::');
  const h = head ? head.split(':') : [];
  const r = rest !== undefined && rest !== '' ? rest.split(':') : [];
  const fill = a.includes('::') ? 8 - h.length - r.length : 0;
  const groups = [
    ...h,
    ...new Array<string>(Math.max(0, fill)).fill('0'),
    ...r,
  ].map((g) => parseInt(g || '0', 16));
  return groups.length === 8 &&
    groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)
    ? groups
    : null;
}

/** Whether the server must not connect to this address. */
export function blockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const parts = v4(address);
    return BLOCKED_V4.some(([base, bits]) => inV4(parts, base, bits));
  }
  if (family === 6) {
    const g = v6Groups(address);
    if (!g) return true;
    if (g.every((x) => x === 0)) return true; // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true; // ::1
    const embedded = `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`;
    if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff)
      return blockedAddress(embedded); // IPv4-mapped
    if (g[0] === 0x64 && g[1] === 0xff9b) return blockedAddress(embedded); // NAT64
    if (g.slice(0, 6).every((x) => x === 0)) return true; // IPv4-compatible, deprecated
    if ((g[0] & 0xfe00) === 0xfc00) return true; // unique local fc00::/7
    if ((g[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
    if ((g[0] & 0xff00) === 0xff00) return true; // multicast
    if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
    if (g[0] === 0x0100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // discard
    if (g[0] === 0x2002)
      return blockedAddress(
        `${g[1] >> 8}.${g[1] & 0xff}.${g[2] >> 8}.${g[2] & 0xff}`,
      ); // 6to4
    return false;
  }
  return true;
}

type LookupAll = (
  hostname: string,
  options: { all: true },
  callback: (
    err: NodeJS.ErrnoException | null,
    addresses: Array<{ address: string; family: number }>,
  ) => void,
) => void;

/** Resolves `host` and refuses it when any of its addresses is blocked. `allowLoopback` is the development exception for localhost. */
export function checkResolved(
  host: string,
  allowLoopback: boolean,
  lookup: LookupAll = dnsLookup,
): Promise<{ ok: true; addresses: string[] } | { ok: false; reason: string }> {
  return new Promise((resolve) => {
    lookup(host.replace(/^\[|\]$/g, ''), { all: true }, (err, addresses) => {
      if (err || !addresses?.length)
        return resolve({
          ok: false,
          reason: 'That host name could not be found.',
        });
      const loopback = (a: string) => a === '::1' || a.startsWith('127.');
      const bad = addresses.find(
        (a) =>
          blockedAddress(a.address) && !(allowLoopback && loopback(a.address)),
      );
      if (bad)
        return resolve({
          ok: false,
          reason:
            'That host resolves to a private or reserved network address, which the server does not call.',
        });
      resolve({ ok: true, addresses: addresses.map((a) => a.address) });
    });
  });
}

/** A `lookup` for sockets that refuses blocked addresses at connect time. */
export function guardedLookup(allowLoopback: boolean): LookupFunction {
  return (
    hostname: string,
    options: { all?: boolean },
    callback: (
      err: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ) => {
    dnsLookup(hostname, { all: true }, (err, addresses) => {
      if (err) return callback(err, '', 0);
      const loopback = (a: string) => a === '::1' || a.startsWith('127.');
      const allowed = addresses.filter(
        (a) =>
          !blockedAddress(a.address) || (allowLoopback && loopback(a.address)),
      );
      if (!allowed.length || allowed.length !== addresses.length) {
        return callback(
          Object.assign(
            new Error('Refused to connect to a private or reserved address.'),
            { code: 'EADDRBLOCKED' },
          ),
          '',
          0,
        );
      }
      if (options?.all) return callback(null, allowed);
      callback(null, allowed[0].address, allowed[0].family);
    });
  };
}

/**
 * A fetch (enough of one for the provider SDKs) whose connections are checked at connect time: every address the name resolves to must pass `blockedAddress` (loopback too, unless `allowLoopback`). Redirects are returned as they are, never followed, so a public host cannot bounce the request inward.
 */
export function guardedFetch(allowLoopback: boolean): typeof fetch {
  const lookup = guardedLookup(allowLoopback);
  return (input: string | URL | Request, init: RequestInit = {}) =>
    new Promise<Response>((resolve, reject) => {
      const url = new URL(
        typeof input === 'string' || input instanceof URL
          ? input.toString()
          : input.url,
      );
      const headers: Record<string, string> = {};
      new Headers(
        init.headers ?? (input instanceof Request ? input.headers : undefined),
      ).forEach((value, name) => (headers[name] = value));
      const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
      const req = send(url, { method: init.method ?? 'GET', headers, lookup });
      const signal = init.signal;
      const onAbort = () =>
        req.destroy(
          Object.assign(new Error('The request was aborted.'), {
            name: 'AbortError',
          }),
        );
      if (signal?.aborted) return onAbort();
      signal?.addEventListener('abort', onAbort, { once: true });
      req.on('error', (err) => {
        signal?.removeEventListener('abort', onAbort);
        reject(err);
      });
      req.on('response', (res) => {
        const out = new Headers();
        for (const [name, value] of Object.entries(res.headers))
          if (value !== undefined)
            out.set(
              name,
              Array.isArray(value) ? value.join(', ') : String(value),
            );
        const empty =
          res.statusCode === 204 ||
          res.statusCode === 304 ||
          (init.method ?? 'GET') === 'HEAD';
        res.on('close', () => signal?.removeEventListener('abort', onAbort));
        resolve(
          new Response(empty ? null : (Readable.toWeb(res) as ReadableStream), {
            status: res.statusCode ?? 502,
            statusText: res.statusMessage,
            headers: out,
          }),
        );
      });
      const body = init.body;
      if (body == null) req.end();
      else if (typeof body === 'string' || body instanceof Uint8Array)
        req.end(body);
      else if (body instanceof ArrayBuffer) req.end(Buffer.from(body));
      else reject(new Error('Unsupported request body for a guarded request.'));
    });
}
