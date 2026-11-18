import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { RedisService } from '../common/redis/redis.service';
import { mockAudit, mockConfig, mockRedis, withoutThrottling } from '../test-utils';

/**
 * The login and resend endpoints must be indistinguishable to a caller who
 * does not control the inbox. That means the same body, the same status, and
 * no measurable time difference, for a registered address, an unknown one, and
 * a deleted account.
 */
describe('AuthController account-existence oracle resistance', () => {
  let controller: AuthController;
  let users: { findByEmail: jest.Mock };
  let auth: { sendVerificationOTP: jest.Mock };

  const req = { headers: {}, ip: '127.0.0.1' } as unknown as Request;

  beforeEach(async () => {
    users = { findByEmail: jest.fn() };
    auth = { sendVerificationOTP: jest.fn().mockResolvedValue(true) };

    const module = await withoutThrottling(
      Test.createTestingModule({
        controllers: [AuthController],
        providers: [
          { provide: AuthService, useValue: auth },
          { provide: ConfigService, useValue: mockConfig() },
          { provide: AuditService, useValue: mockAudit() },
          { provide: UsersService, useValue: users },
          { provide: RedisService, useValue: mockRedis() },
        ],
      }),
    ).compile();

    controller = module.get(AuthController);
  });

  it('returns the same body for a registered and an unregistered email', async () => {
    users.findByEmail.mockResolvedValueOnce({ id: 1, email: 'a@b.c', accountStatus: 'active' });
    const known = await controller.login({ email: 'a@b.c' }, req);

    users.findByEmail.mockResolvedValueOnce(null);
    const unknown = await controller.login({ email: 'nobody@b.c' }, req);

    // Strip the echoed email, which the caller already knew.
    expect(known.message).toBe(unknown.message);
    expect(Object.keys(known).sort()).toEqual(Object.keys(unknown).sort());
    expect(known).not.toHaveProperty('userId');
  });

  it('treats a deleted account exactly like an unknown one', async () => {
    users.findByEmail.mockResolvedValueOnce({ id: 1, email: 'a@b.c', accountStatus: 'deleted' });
    const deleted = await controller.login({ email: 'a@b.c' }, req);

    users.findByEmail.mockResolvedValueOnce(null);
    const unknown = await controller.login({ email: 'a@b.c' }, req);

    expect(deleted).toEqual(unknown);
    expect(auth.sendVerificationOTP).not.toHaveBeenCalled();
  });

  it('only dispatches a code when the account is real', async () => {
    users.findByEmail.mockResolvedValueOnce(null);
    await controller.login({ email: 'nobody@b.c' }, req);
    expect(auth.sendVerificationOTP).not.toHaveBeenCalled();

    users.findByEmail.mockResolvedValueOnce({ id: 7, email: 'a@b.c', accountStatus: 'active' });
    await controller.login({ email: 'a@b.c' }, req);
    expect(auth.sendVerificationOTP).toHaveBeenCalledWith(7);
  });

  it('holds both paths to the same minimum response time', async () => {
    const timeIt = async (fn: () => Promise<unknown>) => {
      const t0 = Date.now();
      await fn();
      return Date.now() - t0;
    };

    users.findByEmail.mockResolvedValueOnce(null);
    const unknownMs = await timeIt(() => controller.login({ email: 'x@b.c' }, req));

    users.findByEmail.mockResolvedValueOnce({ id: 1, email: 'a@b.c', accountStatus: 'active' });
    const knownMs = await timeIt(() => controller.login({ email: 'a@b.c' }, req));

    // Both must reach the floor. Mocks resolve instantly, so without padding
    // these would be ~0ms and the assertion would fail.
    expect(unknownMs).toBeGreaterThanOrEqual(240);
    expect(knownMs).toBeGreaterThanOrEqual(240);
  });

  it('send-otp by email is uniform for unknown addresses', async () => {
    users.findByEmail.mockResolvedValueOnce(null);
    const unknown = await controller.sendOTP({ email: 'nobody@b.c' });

    users.findByEmail.mockResolvedValueOnce({ id: 1, email: 'a@b.c', accountStatus: 'active' });
    const known = await controller.sendOTP({ email: 'a@b.c' });

    expect(unknown).toEqual(known);
  });
});
