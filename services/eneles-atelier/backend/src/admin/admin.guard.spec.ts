import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../prisma/prisma.service';
import { AdminGuard } from './admin.guard';
import { RootAdmin } from './root-admin';

type Account = {
  id: number;
  email: string;
  name: string;
  accountStatus: string;
  verified: boolean;
  isAdmin: boolean;
};

const account = (over: Partial<Account> = {}): Account => ({
  id: 7,
  email: 'ops@eneles.org',
  name: 'Ops',
  accountStatus: 'active',
  verified: true,
  isAdmin: false,
  ...over,
});

function setup(
  found: Account | null,
  env: Record<string, string> = {},
  userId: unknown = 7,
) {
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const prisma = {
    client: { user: { findUnique: jest.fn().mockResolvedValue(found) } },
  } as unknown as PrismaService;
  const request: { user?: { sub: unknown }; admin?: unknown } = {
    user: { sub: userId },
  };
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  return {
    guard: new AdminGuard(prisma, new RootAdmin(config, prisma)),
    context,
    request,
  };
}

describe('AdminGuard', () => {
  it('refuses an ordinary account', async () => {
    const { guard, context } = setup(account());
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('lets a flagged account in and attaches it to the request', async () => {
    const { guard, context, request } = setup(account({ isAdmin: true }));
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.admin).toEqual({
      id: 7,
      email: 'ops@eneles.org',
      name: 'Ops',
      root: false,
    });
  });

  it('lets the root account in, whatever the letter case of its address', async () => {
    const { guard, context, request } = setup(
      account({ email: 'Admin@Eneles.org' }),
      { ADMIN_EMAIL: 'admin@eneles.org' },
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.admin).toMatchObject({ root: true });
  });

  it('refuses a flagged account that is deleted, unverified, or missing', async () => {
    for (const found of [
      account({ isAdmin: true, accountStatus: 'deleted' }),
      account({ isAdmin: true, verified: false }),
      null,
    ]) {
      const { guard, context } = setup(found);
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    }
  });

  it('refuses a request with no signed-in account', async () => {
    const { guard, context } = setup(account({ isAdmin: true }), {}, null);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

describe('RootAdmin', () => {
  const make = (env: Record<string, string>) =>
    new RootAdmin(
      { get: (key: string) => env[key] } as unknown as ConfigService,
      {} as PrismaService,
    );

  it('knows its address whatever the letter case or spaces', () => {
    const root = make({ ADMIN_EMAIL: ' Admin@Eneles.org ' });
    expect(root.email).toBe('admin@eneles.org');
    expect(root.isRoot('ADMIN@eneles.org ')).toBe(true);
    expect(root.isRoot('someone@eneles.org')).toBe(false);
  });

  it('is no one when ADMIN_EMAIL is unset', () => {
    const root = make({});
    expect(root.email).toBeNull();
    expect(root.isRoot('')).toBe(false);
    expect(root.isRoot(undefined)).toBe(false);
  });
});
