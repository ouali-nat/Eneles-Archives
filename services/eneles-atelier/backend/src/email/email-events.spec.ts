import { createHmac } from 'crypto';
import {
  eventDetail,
  maskCodes,
  nextStatus,
  verifyResendWebhook,
} from './email-events';

describe('Resend webhook helpers', () => {
  const key = Buffer.from('test-key-not-real-0123456789');
  const secret = `whsec_${key.toString('base64')}`;
  const body = Buffer.from(
    '{"type":"email.delivered","data":{"email_id":"abc"}}',
  );
  const sign = (id: string, ts: string, raw: Buffer) =>
    `v1,${createHmac('sha256', key).update(`${id}.${ts}.`).update(raw).digest('base64')}`;
  const now = Date.now();
  const ts = String(Math.floor(now / 1000));

  it('accepts a correctly signed request, among several signatures', () => {
    expect(
      verifyResendWebhook(
        secret,
        {
          id: 'msg_1',
          timestamp: ts,
          signature: `v1,bm9wZQ== ${sign('msg_1', ts, body)}`,
        },
        body,
        now,
      ),
    ).toBe(true);
  });

  it('refuses a changed body, a wrong id, an old timestamp, and no secret', () => {
    const signature = sign('msg_1', ts, body);
    expect(
      verifyResendWebhook(
        secret,
        { id: 'msg_1', timestamp: ts, signature },
        Buffer.from(`${body.toString()} `),
        now,
      ),
    ).toBe(false);
    expect(
      verifyResendWebhook(
        secret,
        { id: 'msg_2', timestamp: ts, signature },
        body,
        now,
      ),
    ).toBe(false);
    const old = String(Math.floor(now / 1000) - 600);
    expect(
      verifyResendWebhook(
        secret,
        { id: 'msg_1', timestamp: old, signature: sign('msg_1', old, body) },
        body,
        now,
      ),
    ).toBe(false);
    expect(
      verifyResendWebhook(
        '',
        { id: 'msg_1', timestamp: ts, signature },
        body,
        now,
      ),
    ).toBe(false);
  });

  it('masks code-like numbers in subjects', () => {
    expect(maskCodes('482913 is your Eneles verification code')).toBe(
      '•••••• is your Eneles verification code',
    );
    expect(maskCodes('Euler invited you to "Notes" | Eneles')).toBe(
      'Euler invited you to "Notes" | Eneles',
    );
  });

  it('keeps the furthest status, and a bounce over a later open', () => {
    expect(nextStatus('sent', 'email.delivered')).toBe('delivered');
    expect(nextStatus('opened', 'email.delivered')).toBe('opened');
    expect(nextStatus('bounced', 'email.opened')).toBe('bounced');
    expect(nextStatus('delivered', 'email.scheduled')).toBe('delivered');
  });

  it('keeps only a click link host, never the full link', () => {
    expect(
      eventDetail({
        type: 'email.clicked',
        data: { click: { link: 'https://texer.org/invite?token=secret' } },
      }),
    ).toEqual({ host: 'texer.org' });
  });
});
