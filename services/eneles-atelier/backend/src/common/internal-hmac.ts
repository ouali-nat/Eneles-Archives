import * as crypto from 'crypto';

/** The hex SHA-256 of the exact bytes sent (the hash of the empty string when there is no body). */
export function sha256Hex(body: Buffer | string | null | undefined): string {
  return crypto
    .createHash('sha256')
    .update(body ?? '')
    .digest('hex');
}

/**
 * The headers that sign an internal service call (Eneles's API to Axya's AI service, which refuses an unsigned or mis-signed request with 403):
 *
 * - `X-Internal-Timestamp`: unix seconds. The receiver accepts it within 300 seconds of its own clock.
 * - `X-Internal-Body-SHA256`: the hex SHA-256 of the exact body bytes sent, or of the empty string when there is no body.
 * - `X-Internal-Signature`: the hex HMAC-SHA256, with the shared `INTERNAL_API_SECRET`, of `"{timestamp}.{METHOD}.{path}.{body_sha256}"`, where `path` is the URL path without its query string.
 *
 * `body` must be the bytes that actually go on the wire: the exact JSON string sent, or a multipart form already built into a buffer (and sent as that buffer, with its boundary in `Content-Type`).
 */
export function signInternalRequest(
  secret: string,
  method: string,
  path: string,
  body?: Buffer | string | null,
): Record<string, string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const barepath = path.split('?')[0] || '/';
  const bodyHash = sha256Hex(body);
  const message = `${timestamp}.${method.toUpperCase()}.${barepath}.${bodyHash}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');

  return {
    'X-Internal-Timestamp': timestamp,
    'X-Internal-Body-SHA256': bodyHash,
    'X-Internal-Signature': signature,
  };
}
