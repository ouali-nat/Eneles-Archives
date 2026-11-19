import { Test } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../email/email.service';
import { UsersService } from '../users/users.service';
import { RedisService } from '../common/redis/redis.service';
import { mockPrisma, mockEmail, mockRedis } from '../test-utils';

describe('AuthService token issuance', () => {
  let service: AuthService;
  let jwt: { sign: jest.Mock; verify: jest.Mock };

  beforeEach(async () => {
    jwt = { sign: jest.fn().mockReturnValue('signed.jwt'), verify: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: mockPrisma() },
        { provide: EmailService, useValue: mockEmail() },
        { provide: JwtService, useValue: jwt },
        { provide: UsersService, useValue: {} },
        { provide: RedisService, useValue: mockRedis() },
      ],
    }).compile();
    service = module.get(AuthService);
  });

  it('binds every token to a session id so it can be revoked', async () => {
    await service.generateToken({ id: 1, email: 'a@b.c', name: 'A' }, 'sess-123');

    expect(jwt.sign).toHaveBeenCalledWith(
      expect.objectContaining({ sub: 1, sid: 'sess-123' }),
    );
  });

  it('refuses to mint a token with no session, which could never be revoked', async () => {
    await expect(
      service.generateToken({ id: 1, email: 'a@b.c', name: 'A' }, ''),
    ).rejects.toThrow(/session token/);
    expect(jwt.sign).not.toHaveBeenCalled();
  });
});
