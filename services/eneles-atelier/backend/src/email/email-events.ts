import { createHmac, timingSafeEqual } from 'crypto';

/** Any 4 to 8 digit run in a subject, masked: sign-in codes must never be stored, even when Resend reports an email this API did not record. */
export function maskCodes(text: string): string {
  return text.replace(/\b\d{4,8}\b/g, '••••••');
}

/** How far an email got, so a late "delivered" never overwrites "opened", and a bounce is never hidden by a later open. */
const RANK: Record<string, number> = {
  sent: 1,
  delivery_delayed: 2,
  delivered: 3,
  opened: 4,
  clicked: 5,
  failed: 6,
  bounced: 7,
  complained: 8,
};
export const EMAIL_STATUSES = Object.keys(RANK);

/** The status a message has after an event: the further of the two. Events this API does not track (scheduled, received) leave it as it is. */
export function nextStatus(current: string, eventType: string): string {
  const incoming = eventType.replace(/^email\./, '');
  if (!(incoming in RANK)) return current;
  return (RANK[incoming] ?? 0) > (RANK[current] ?? 0) ? incoming : current;
}

/**
 * Verifies a Resend webhook, which Resend signs the Svix way: headers `svix-id`, `svix-timestamp` (unix seconds), and `svix-signature` (space-separated `v1,<base64>` entries), over `"{id}.{timestamp}.{raw body}"` with the endpoint's signing secret (`whsec_` followed by the base64 key). A timestamp more than five minutes from now is refused, so a captured request cannot be replayed later.
 */
export function verifyResendWebhook(
  secret: string,
  headers: { id?: string; timestamp?: string; signature?: string },
  rawBody: Buffer,
  now = Date.now(),
): boolean {
  const { id, timestamp, signature } = headers;
  if (!secret || !id || !timestamp || !signature) return false;
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(now / 1000 - seconds) > 300)
    return false;
  const key = Buffer.from(
    secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret,
    'base64',
  );
  const expected = createHmac('sha256', key)
    .update(`${id}.${timestamp}.`)
    .update(rawBody)
    .digest();
  return signature.split(' ').some((part) => {
    const [version, value] = part.split(',');
    if (version !== 'v1' || !value) return false;
    const given = Buffer.from(value, 'base64');
    return given.length === expected.length && timingSafeEqual(given, expected);
  });
}

/** What a Resend email event carries, as far as this API reads it. */
export interface ResendEvent {
  type: string;
  created_at?: string;
  data?: {
    email_id?: string;
    from?: string;
    to?: string[] | string;
    subject?: string;
    created_at?: string;
    bounce?: { type?: string; subType?: string; message?: string };
    click?: { link?: string; timestamp?: string };
  };
}

/** The part of an event worth keeping: a bounce's type and reason, a click's link host. Never the email's content or a full link (links in sign-in emails can carry tokens). */
export function eventDetail(event: ResendEvent): Record<string, string> | null {
  const bounce = event.data?.bounce;
  if (bounce) {
    return Object.fromEntries(
      Object.entries({
        type: bounce.type,
        subType: bounce.subType,
        message: bounce.message
          ? maskCodes(bounce.message).slice(0, 500)
          : undefined,
      }).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
  }
  const link = event.data?.click?.link;
  if (link) {
    try {
      return { host: new URL(link).host };
    } catch {
      return null;
    }
  }
  return null;
}
