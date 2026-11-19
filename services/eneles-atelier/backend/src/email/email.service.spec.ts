import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { mockConfig } from '../test-utils';

describe('EmailService', () => {
  it('constructs without a RESEND_API_KEY and degrades rather than throwing', async () => {
    const module = await Test.createTestingModule({
      providers: [
        EmailService,
        { provide: ConfigService, useValue: mockConfig() },
      ],
    }).compile();
    expect(module.get(EmailService)).toBeDefined();
  });

  it('generates six-digit numeric OTP codes', async () => {
    const module = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: mockConfig({ RESEND_API_KEY: 'test' }),
        },
      ],
    }).compile();
    const service = module.get(EmailService);
    for (let i = 0; i < 20; i++) {
      expect(service.generateOTP()).toMatch(/^\d{6}$/);
    }
  });

  it('logs mail instead of sending when no provider is set outside production', async () => {
    const module = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: mockConfig({ NODE_ENV: 'development' }),
        },
      ],
    }).compile();
    const service = module.get(EmailService);
    await expect(
      service.sendOTPEmail('a@example.test', '123456'),
    ).resolves.toBe(true);
  });

  it('never takes the log path in production', async () => {
    const module = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: mockConfig({ NODE_ENV: 'production' }),
        },
      ],
    }).compile();
    const service = module.get(EmailService);
    await expect(
      service.sendOTPEmail('a@example.test', '123456'),
    ).resolves.toBe(false);
  });
});
