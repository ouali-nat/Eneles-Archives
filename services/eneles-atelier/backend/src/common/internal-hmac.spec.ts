import * as crypto from 'crypto';
import { sha256Hex, signInternalRequest } from './internal-hmac';

/** The signature Axya's AI service checks: HMAC-SHA256 over "{timestamp}.{METHOD}.{path}.{body_sha256}", the path without its query, the body hash of the exact bytes. */
describe('signInternalRequest', () => {
  const secret = 'test-secret-not-real';
  const expected = (
    ts: string,
    method: string,
    path: string,
    body: Buffer | string,
  ) =>
    crypto
      .createHmac('sha256', secret)
      .update(
        `${ts}.${method}.${path}.${crypto.createHash('sha256').update(body).digest('hex')}`,
      )
      .digest('hex');

  it('signs the exact body bytes and returns the three headers', () => {
    const body = Buffer.from('{"a":1,"b":"é"}');
    const h = signInternalRequest(secret, 'post', '/v1/extract/pdf/tex', body);
    expect(Object.keys(h).sort()).toEqual([
      'X-Internal-Body-SHA256',
      'X-Internal-Signature',
      'X-Internal-Timestamp',
    ]);
    expect(h['X-Internal-Body-SHA256']).toBe(sha256Hex(body));
    expect(h['X-Internal-Signature']).toBe(
      expected(h['X-Internal-Timestamp'], 'POST', '/v1/extract/pdf/tex', body),
    );
  });

  it('hashes the empty string when there is no body', () => {
    const h = signInternalRequest(secret, 'GET', '/v1/health');
    expect(h['X-Internal-Body-SHA256']).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('signs the path without its query string', () => {
    const h = signInternalRequest(
      secret,
      'GET',
      '/v1/health?service_id=marker',
    );
    expect(h['X-Internal-Signature']).toBe(
      expected(h['X-Internal-Timestamp'], 'GET', '/v1/health', ''),
    );
  });
});
