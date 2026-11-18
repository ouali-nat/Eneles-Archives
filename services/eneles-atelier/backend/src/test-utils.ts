/**
 * Shared test doubles.
 *
 * Every spec in this codebase used to compile a TestingModule with no
 * providers at all, so all ten failed on dependency resolution the moment a
 * service grew a constructor argument. These factories give each spec a
 * complete, inert dependency graph in one line, and a Prisma double whose
 * models can be pointed at whatever rows a test needs.
 */

import { ThrottlerGuard } from '@nestjs/throttler';
import type { TestingModuleBuilder } from '@nestjs/testing';

type AnyFn = (...args: any[]) => any;

/** A Prisma model surface where every method is a jest.fn(). */
export function mockModel() {
  return {
    findUnique: jest.fn(),
    findFirst: jest.fn(),
    findMany: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    updateMany: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    deleteMany: jest.fn(),
    count: jest.fn(),
    aggregate: jest.fn(),
  };
}

/**
 * A PrismaService double. `client.<model>` returns a fresh mockModel on first
 * access, so tests only configure the models they use.
 */
export function mockPrisma() {
  const models = new Map<string, ReturnType<typeof mockModel>>();
  const client = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === '$transaction') {
          return jest.fn((ops: unknown) =>
            Array.isArray(ops) ? Promise.all(ops) : (ops as AnyFn)(client),
          );
        }
        if (prop === '$queryRaw') return jest.fn().mockResolvedValue([{ 1: 1 }]);
        if (!models.has(prop)) models.set(prop, mockModel());
        return models.get(prop);
      },
    },
  ) as Record<string, ReturnType<typeof mockModel>> & {
    $transaction: jest.Mock;
  };

  return {
    client,
    healthCheck: jest.fn().mockResolvedValue(true),
    getPoolStats: jest.fn().mockReturnValue({}),
  };
}

export function mockConfig(values: Record<string, unknown> = {}) {
  return {
    get: jest.fn((key: string, fallback?: unknown) =>
      key in values ? values[key] : fallback,
    ),
    getOrThrow: jest.fn((key: string) => {
      if (!(key in values)) throw new Error(`Missing config ${key}`);
      return values[key];
    }),
  };
}

export function mockStorage() {
  return {
    uploadFile: jest.fn().mockResolvedValue(undefined),
    getSignedUrl: jest.fn().mockResolvedValue('https://signed.example/file'),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    getFileSize: jest.fn().mockResolvedValue(1234),
    getObject: jest.fn(),
  };
}

export function mockUsage() {
  return {
    canUseSnip: jest.fn().mockResolvedValue(true),
    canUsePdfPage: jest.fn().mockResolvedValue(true),
    incrementSnipUsage: jest.fn().mockResolvedValue(undefined),
    incrementPdfPageUsage: jest.fn().mockResolvedValue(undefined),
    incrementConversionUsage: jest.fn().mockResolvedValue(undefined),
    getCurrentMonthUsage: jest.fn(),
    getStatistics: jest.fn(),
  };
}

export function mockRedis() {
  return {
    isConnected: false,
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    getJson: jest.fn(),
    setJson: jest.fn(),
  };
}

export function mockAudit() {
  return {
    log: jest.fn().mockResolvedValue(undefined),
    logAuth: jest.fn().mockResolvedValue(undefined),
  };
}

export function mockEmail() {
  return {
    sendOTPEmail: jest.fn().mockResolvedValue(true),
    sendInvitationEmail: jest.fn().mockResolvedValue(true),
    generateOTP: jest.fn().mockReturnValue('123456'),
  };
}

/**
 * Controllers decorated with @UseGuards(ThrottlerGuard) need THROTTLER module
 * options at compile time. Tests are not exercising rate limiting, so the
 * guard is replaced with one that always passes.
 */
export function withoutThrottling(builder: TestingModuleBuilder) {
  return builder.overrideGuard(ThrottlerGuard).useValue({ canActivate: () => true });
}
