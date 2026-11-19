import { Test } from '@nestjs/testing';
import { HttpStatus } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { StorageService } from '../storage/storage.service';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { mockPrisma, mockStorage, withoutThrottling } from '../test-utils';

describe('UsersController tenant isolation', () => {
  let controller: UsersController;
  let users: { findOne: jest.Mock; update: jest.Mock; remove: jest.Mock };

  const ME = 1;
  const SOMEONE_ELSE = 2;

  beforeEach(async () => {
    users = { findOne: jest.fn(), update: jest.fn(), remove: jest.fn() };

    const module = await withoutThrottling(
      Test.createTestingModule({
        controllers: [UsersController],
        providers: [
          { provide: UsersService, useValue: users },
          { provide: StorageService, useValue: mockStorage() },
          { provide: PrismaService, useValue: mockPrisma() },
          { provide: BillingService, useValue: { endForDeletedAccount: jest.fn() } },
        ],
      }),
    ).compile();

    controller = module.get(UsersController);
  });

  it('refuses to read another user\u2019s profile by id', async () => {
    await expect(controller.findOne(ME, String(SOMEONE_ELSE))).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(users.findOne).not.toHaveBeenCalled();
  });

  it('refuses to delete another user\u2019s account', async () => {
    await expect(controller.remove(ME, String(SOMEONE_ELSE))).rejects.toMatchObject({
      status: HttpStatus.FORBIDDEN,
    });
    expect(users.remove).not.toHaveBeenCalled();
  });

  it('allows a user to read their own profile by id', async () => {
    users.findOne.mockResolvedValue({ id: ME, email: 'me@example.com' });
    await expect(controller.findOne(ME, String(ME))).resolves.toMatchObject({ id: ME });
  });
});
