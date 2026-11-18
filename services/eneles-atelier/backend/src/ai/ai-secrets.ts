import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

/**
 * Sealing people's model keys at rest: AES-256-GCM under a key derived from AI_KEY_SECRET, a fresh 12-byte nonce per key, and the authentication tag kept with it, so a sealed key that was changed or sealed under another secret fails to open instead of opening to garbage. Pure functions: the service passes the secret in, and the tests can too.
 */

/** The shortest AI_KEY_SECRET accepted. Shorter, keys are not stored at all. */
export const MIN_SECRET_LENGTH = 32;

/** Provider keys longer than this are refused before anything else is done with them. */
export const MAX_KEY_LENGTH = 512;

const VERSION = 'v1';

export function sealingKey(secret: string | undefined | null): Buffer | null {
  if (!secret || secret.length < MIN_SECRET_LENGTH) return null;
  return createHash('sha256')
    .update(`texer-ai-provider-key:${secret}`)
    .digest();
}

/** `v1.iv.tag.body`, each part base64. */
export function sealSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    body.toString('base64'),
  ].join('.');
}

/** The plain key, or null when the sealed value is malformed, was tampered with, or was sealed under another secret. */
export function openSecret(sealed: string, key: Buffer): string | null {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== VERSION || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(iv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(body, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    return null;
  }
}

/** The part of a key that is shown: its last four characters. */
export function keyTail(key: string): string {
  return key.slice(-4);
}

/** A key as typed: trimmed, and refused when it is empty, too long, or holds whitespace or control characters (a paste that took a line break or a label with it). */
export function cleanKey(
  raw: unknown,
): { ok: true; key: string } | { ok: false; reason: string } {
  if (typeof raw !== 'string')
    return { ok: false, reason: 'Enter the API key.' };
  const key = raw.trim();
  if (!key) return { ok: false, reason: 'Enter the API key.' };
  if (key.length > MAX_KEY_LENGTH)
    return {
      ok: false,
      reason: `That is longer than any API key (${MAX_KEY_LENGTH} characters at most).`,
    };
  // eslint-disable-next-line no-control-regex
  if (/[\s\u0000-\u001f\u007f]/.test(key))
    return {
      ok: false,
      reason:
        'The key has spaces or line breaks in it. Copy it again from the provider.',
    };
  return { ok: true, key };
}

/** Removes anything that looks like a key from a message before it is logged or shown: long runs of key characters, and `key=` query values. */
export function redactSecrets(
  text: string,
  ...known: Array<string | null | undefined>
): string {
  let out = text;
  for (const k of known)
    if (k && k.length >= 6) out = out.split(k).join('[key]');
  out = out.replace(
    /(key|token|authorization|bearer)([=:\s]+)[^\s&"',]+/gi,
    '$1$2[redacted]',
  );
  out = out.replace(/\b(sk|pk|rk|gsk|xai|AIza)[-_A-Za-z0-9]{12,}/g, '[key]');
  out = out.replace(/\b[A-Za-z0-9_-]{40,}\b/g, '[redacted]');
  return out;
}
