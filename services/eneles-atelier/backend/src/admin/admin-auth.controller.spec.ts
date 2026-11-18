import { HttpException } from '@nestjs/common';
import {
  ADMIN_CODE_LIMITS,
  AdminAuthController,
} from './admin-auth.controller';

/** The panel's sign-in: a code only for administrators, the same answer for anyone, and limits per network and per mailbox. */
describe('AdminAuthController', () => {
  const users: Record<string, object> = {
    'ops@texer.org': {
      id: 2,
      isAdmin: true,
      verified: true,
      accountStatus: 'active',
    },
    'someone@texer.org': {
      id: 3,
      isAdmin: false,
      verified: true,
      accountStatus: 'active',
    },
    'gone@texer.org': {
      id: 4,
      isAdmin: true,
      verified: true,
      accountStatus: 'suspended',
    },
  };
  let auth: { sendVerificationOTP: jest.Mock };
  let root: { isRoot: (e: string) => boolean; account: jest.Mock };
  let controller: AdminAuthController;
  let ip = 0;
  const req = (address = `10.0.0.${++ip}`) =>
    ({ ip: address, headers: { 'user-agent': 'test' } }) as never;

  beforeEach(() => {
    jest.useFakeTimers({ advanceTimers: true });
    auth = { sendVerificationOTP: jest.fn().mockResolvedValue(true) };
    root = {
      isRoot: (e: string) => e === 'admin@texer.org',
      account: jest.fn().mockResolvedValue({ id: 1 }),
    };
    const prisma = {
      client: {
        user: {
          findUnique: jest.fn(({ where }: { where: { email: string } }) =>
            Promise.resolve(users[where.email] ?? null),
          ),
        },
      },
    };
    controller = new AdminAuthController(
      root as never,
      auth as never,
      { log: jest.fn() } as never,
      { isConnected: false } as never,
      prisma as never,
    );
  });
  afterEach(() => jest.useRealTimers());

  it('sends a code to the root account and to a flagged account', async () => {
    await controller.requestCode({ email: ' Admin@Eneles.org' }, req());
    await controller.requestCode({ email: 'ops@texer.org' }, req());
    expect(auth.sendVerificationOTP.mock.calls).toEqual([
      [1, { admin: true }],
      [2, { admin: true }],
    ]);
  });

  it('answers anyone else the same way, and sends nothing', async () => {
    const answers = await Promise.all(
      ['someone@texer.org', 'gone@texer.org', 'nobody@texer.org'].map((email) =>
        controller.requestCode({ email }, req()),
      ),
    );
    const admin = await controller.requestCode(
      { email: 'ops@texer.org' },
      req(),
    );
    for (const answer of answers) expect(answer.message).toBe(admin.message);
    expect(auth.sendVerificationOTP).toHaveBeenCalledTimes(1);
  });

  it('sends one code a minute to a mailbox, silently', async () => {
    await controller.requestCode({ email: 'ops@texer.org' }, req());
    await controller.requestCode({ email: 'ops@texer.org' }, req());
    expect(auth.sendVerificationOTP).toHaveBeenCalledTimes(1);
    jest.setSystemTime(
      Date.now() + ADMIN_CODE_LIMITS.cooldown.seconds * 1000 + 1,
    );
    await controller.requestCode({ email: 'ops@texer.org' }, req());
    expect(auth.sendVerificationOTP).toHaveBeenCalledTimes(2);
  });

  it('refuses one network after too many requests in an hour', async () => {
    for (let i = 0; i < ADMIN_CODE_LIMITS.network.max; i++)
      await controller.requestCode(
        { email: `x${i}@texer.org` },
        req('10.9.9.9'),
      );
    await expect(
      controller.requestCode({ email: 'ops@texer.org' }, req('10.9.9.9')),
    ).rejects.toMatchObject({ status: 429 });
    await expect(
      controller.requestCode({ email: 'ops@texer.org' }, req('10.9.9.9')),
    ).rejects.toBeInstanceOf(HttpException);
    expect(auth.sendVerificationOTP).not.toHaveBeenCalled();
  });
});
