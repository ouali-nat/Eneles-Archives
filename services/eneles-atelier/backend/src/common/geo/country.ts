import { readFileSync } from 'fs';
import { dirname, join } from 'path';

/**
 * Which country an IP address is registered in, as an ISO 3166-1 alpha-2 code.
 *
 * The lookup is local: no address ever leaves the server. The table is the public-domain (CC0) registry data in `@ip-location-db/geo-whois-asn-country`, which says where an address block is registered. That is the country, not the city, and it is wrong for some VPNs and mobile carriers; it is good enough for a flag beside a session.
 *
 * The table loads on the first lookup (about a third of a second and a few megabytes) and stays in memory.
 */

interface Table {
  v4Start: Uint32Array;
  v4End: Uint32Array;
  v4Country: Uint16Array;
  /** The top 64 bits of each IPv6 range. Allocations to networks are /64 or shorter, so the top half decides the country. */
  v6Start: BigUint64Array;
  v6End: BigUint64Array;
  v6Country: Uint16Array;
}

let table: Table | null | undefined;

const pack = (code: string) => (code.charCodeAt(0) << 8) | code.charCodeAt(1);
const unpack = (n: number) => String.fromCharCode(n >> 8, n & 0xff);

function load(): Table | null {
  try {
    const dir = dirname(require.resolve('@ip-location-db/geo-whois-asn-country/package.json'));
    const v4 = readFileSync(join(dir, 'geo-whois-asn-country-ipv4-num.csv'), 'utf8').split('\n').filter(Boolean);
    const v6 = readFileSync(join(dir, 'geo-whois-asn-country-ipv6-num.csv'), 'utf8').split('\n').filter(Boolean);
    const t: Table = {
      v4Start: new Uint32Array(v4.length),
      v4End: new Uint32Array(v4.length),
      v4Country: new Uint16Array(v4.length),
      v6Start: new BigUint64Array(v6.length),
      v6End: new BigUint64Array(v6.length),
      v6Country: new Uint16Array(v6.length),
    };
    v4.forEach((line, i) => {
      const [start, end, country] = line.trim().split(',');
      t.v4Start[i] = Number(start);
      t.v4End[i] = Number(end);
      t.v4Country[i] = pack(country);
    });
    v6.forEach((line, i) => {
      const [start, end, country] = line.trim().split(',');
      t.v6Start[i] = BigInt(start) >> 64n;
      t.v6End[i] = BigInt(end) >> 64n;
      t.v6Country[i] = pack(country);
    });
    return t;
  } catch {
    // Without the table the lookup answers "unknown"; nothing else depends on it.
    return null;
  }
}

/** The index of the last range that starts at or before `value`, or -1. */
function floor<T extends number | bigint>(starts: ArrayLike<T>, value: T): number {
  let lo = 0;
  let hi = starts.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (starts[mid] <= value) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found;
}

function parseV4(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const byte = Number(part);
    if (byte > 255) return null;
    n = n * 256 + byte;
  }
  return n;
}

/** The top 64 bits of an IPv6 address, or null when it is not one. */
function parseV6Top(ip: string): bigint | null {
  const [head, tail, ...rest] = ip.split('::');
  if (rest.length) return null;
  const left = head ? head.split(':') : [];
  const right = tail ? tail.split(':') : [];
  const missing = 8 - left.length - right.length;
  if (tail === undefined ? left.length !== 8 : missing < 1) return null;
  const groups = [...left, ...Array<string>(tail === undefined ? 0 : missing).fill('0'), ...right];
  let top = 0n;
  for (let i = 0; i < 4; i++) {
    if (!/^[0-9a-f]{1,4}$/i.test(groups[i])) return null;
    top = (top << 16n) | BigInt(parseInt(groups[i], 16));
  }
  return top;
}

function isPrivateV4(n: number): boolean {
  const a = n >>> 24;
  const b = (n >>> 16) & 0xff;
  return a === 10 || a === 127 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}

/** The country an address is registered in, or null for private, local, malformed, or unlisted addresses. */
export function countryOf(ip: string | null | undefined): string | null {
  if (!ip) return null;
  let address = ip.trim().toLowerCase();
  // A zone id (fe80::1%eth0) and the IPv4-in-IPv6 form (::ffff:1.2.3.4) both reduce to something simpler.
  address = address.split('%')[0];
  if (address.startsWith('::ffff:') && address.includes('.')) address = address.slice(7);

  if (table === undefined) table = load();
  if (!table) return null;

  if (address.includes('.')) {
    const n = parseV4(address);
    if (n === null || isPrivateV4(n)) return null;
    const i = floor(table.v4Start, n);
    return i >= 0 && n <= table.v4End[i] ? unpack(table.v4Country[i]) : null;
  }

  const top = parseV6Top(address);
  if (top === null) return null;
  const i = floor(table.v6Start, top);
  return i >= 0 && top <= table.v6End[i] ? unpack(table.v6Country[i]) : null;
}
