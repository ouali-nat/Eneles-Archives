import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { AdminActionsService, type Actor } from './admin-actions.service';

/** The rules for who may change which account, and what each change ends. */
describe('AdminActionsService', () => {
  const accounts: Record<number, any> = {};
  const calls: string[] = [];
  const prisma = {
    client: {
      user: {
        findUnique: jest.fn(async ({ where }: any) =>
          accounts[where.id] ? { ...accounts[where.id] } : null,
        ),
        findFirst: jest.fn(async () => null),
        update: jest.fn(async ({ where, data }: any) =>
          Object.assign(accounts[where.id], data),
        ),
      },
      oTP: { deleteMany: jest.fn(async () => ({ count: 0 })) },
    },
  };
  const auth = {
    endAllSessions: jest.fn(async () => (calls.push('endAllSessions'), 2)),
  };
  const users = { remove: jest.fn(async () => calls.push('remove')) };
  const billing = {
    endForDeletedAccount: jest.fn(async () =>
      calls.push('endForDeletedAccount'),
    ),
  };
  const collaboration = {
    disconnectUser: jest.fn(() => (calls.push('disconnectUser'), 1)),
  };
  const root = {
    isRoot: (email?: string | null) => email === 'root@example.com',
  };
  const service = new AdminActionsService(
    prisma as any,
    auth as any,
    users as any,
    billing as any,
    collaboration as any,
    root as any,
  );

  const admin: Actor = {
    id: 2,
    email: 'admin@example.com',
    name: 'Admin',
    root: false,
  };
  const rootActor: Actor = {
    id: 1,
    email: 'root@example.com',
    name: 'Root',
    root: true,
  };

  beforeEach(() => {
    calls.length = 0;
    jest.clearAllMocks();
    accounts[1] = {
      id: 1,
      email: 'root@example.com',
      accountStatus: 'active',
      isAdmin: true,
      verified: true,
      twoFactorEnabled: false,
      subscriptionType: 'free',
    };
    accounts[2] = {
      id: 2,
      email: 'admin@example.com',
      accountStatus: 'active',
      isAdmin: true,
      verified: true,
      twoFactorEnabled: false,
      subscriptionType: 'free',
    };
    accounts[3] = {
      id: 3,
      email: 'person@example.com',
      accountStatus: 'active',
      isAdmin: false,
      verified: false,
      twoFactorEnabled: true,
      subscriptionType: 'free',
    };
    accounts[4] = {
      id: 4,
      email: 'other-admin@example.com',
      accountStatus: 'active',
      isAdmin: true,
      verified: true,
      twoFactorEnabled: false,
      subscriptionType: 'free',
    };
  });

  it('refuses every change to the root account and to your own', async () => {
    await expect(service.setStatus(admin, 1, true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      service.signOutEverywhere(rootActor, 1),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.setPlan(admin, 2, 'pro')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it("leaves another administrator's account to the root administrator", async () => {
    await expect(service.setStatus(admin, 4, true)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(service.setStatus(rootActor, 4, true)).resolves.toMatchObject({
      status: 'suspended',
    });
  });

  it('keeps email changes and deletion for the root administrator', async () => {
    await expect(
      service.changeEmail(admin, 3, 'new@example.com'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.remove(admin, 3, 'person@example.com'),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('disabling an account ends its sessions and closes its sockets', async () => {
    const result = await service.setStatus(admin, 3, true);
    expect(result).toEqual({ id: 3, status: 'suspended', sessionsEnded: 2 });
    expect(accounts[3].accountStatus).toBe('suspended');
    expect(calls).toEqual(['endAllSessions', 'disconnectUser']);
    await expect(service.setStatus(admin, 3, true)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await expect(service.setStatus(admin, 3, false)).resolves.toMatchObject({
      status: 'active',
    });
  });

  it('turns off two-factor sign-in and forgets the secret', async () => {
    await service.disableTwoFactor(admin, 3);
    expect(prisma.client.user.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });
  });

  it('accepts only the four plans', async () => {
    await expect(service.setPlan(admin, 3, 'platinum')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(service.setPlan(admin, 3, 'team')).resolves.toEqual({
      id: 3,
      from: 'free',
      to: 'team',
    });
  });

  it('deletes only when the address is repeated, ending billing and sessions before the soft delete', async () => {
    await expect(
      service.remove(rootActor, 3, 'wrong@example.com'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(calls).toEqual([]);
    await service.remove(rootActor, 3, ' Person@Example.com ');
    expect(calls).toEqual([
      'endForDeletedAccount',
      'endAllSessions',
      'disconnectUser',
      'remove',
    ]);
  });

  it('changes an address only to a valid, unused one, and signs the account out', async () => {
    await expect(
      service.changeEmail(rootActor, 3, 'not an address'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.changeEmail(rootActor, 3, 'root@example.com'),
    ).rejects.toBeInstanceOf(ConflictException);
    prisma.client.user.findFirst.mockResolvedValueOnce({ id: 9 } as never);
    await expect(
      service.changeEmail(rootActor, 3, 'taken@example.com'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.changeEmail(rootActor, 3, 'New@Example.com'),
    ).resolves.toMatchObject({
      from: 'person@example.com',
      to: 'new@example.com',
    });
    expect(calls).toEqual(['endAllSessions', 'disconnectUser']);
  });
});
