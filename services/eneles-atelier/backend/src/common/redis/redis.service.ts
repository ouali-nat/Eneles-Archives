import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

type MemoryEntry = { value: string; expiresAt: number | null };

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis | null = null;
  private readonly memory = new Map<string, MemoryEntry>();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const url = this.configService.get<string>('REDIS_URL');
    const host = this.configService.get<string>('REDIS_HOST');

    // Render Free has one instance. Redis is optional there: use a bounded,
    // process-local fallback instead of repeatedly connecting to localhost.
    if (!url && !host) {
      this.logger.warn('Redis is not configured; using in-memory fallback on this instance.');
      return;
    }

    const password = this.configService.get<string>('REDIS_PASSWORD') || undefined;
    this.client = url
      ? new Redis(url, {
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => Math.min(times * 200, 5000),
          lazyConnect: true,
        })
      : new Redis({
          host,
          port: Number(this.configService.get('REDIS_PORT')) || 6379,
          ...(password ? { password } : {}),
          db: Number(this.configService.get('REDIS_DB')) || 0,
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => Math.min(times * 200, 5000),
          lazyConnect: true,
        });

    this.client.on('error', (err) => {
      this.logger.warn(`Redis unavailable; using in-memory fallback: ${err.message}`);
    });
    this.client.on('connect', () => this.logger.log('✓ Connected to Redis'));

    try {
      await this.client.connect();
    } catch (err) {
      this.logger.warn(`Redis connection failed; using in-memory fallback: ${err.message}`);
      this.client.disconnect();
      this.client = null;
    }
  }

  async onModuleDestroy() {
    if (!this.client) return;
    if (this.client.status === 'ready') await this.client.quit();
    else this.client.disconnect();
    this.logger.log('Redis connection closed');
  }

  /** True if Redis is connected and responsive */
  get isConnected(): boolean {
    return this.client?.status === 'ready';
  }

  /** Raw ioredis client when an external adapter is configured */
  getClient(): Redis | null {
    return this.client;
  }

  private memoryEntry(key: string): MemoryEntry | undefined {
    const entry = this.memory.get(key);
    if (entry?.expiresAt !== null && entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      this.memory.delete(key);
      return undefined;
    }
    return entry;
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (this.isConnected) {
      if (ttlSeconds) await this.client!.setex(key, ttlSeconds, value);
      else await this.client!.set(key, value);
      return;
    }
    this.memory.set(key, {
      value,
      expiresAt: ttlSeconds ? Date.now() + ttlSeconds * 1000 : null,
    });
  }

  async get(key: string): Promise<string | null> {
    if (this.isConnected) return this.client!.get(key);
    return this.memoryEntry(key)?.value ?? null;
  }

  async del(key: string): Promise<void> {
    if (this.isConnected) {
      await this.client!.del(key);
      return;
    }
    this.memory.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    if (this.isConnected) return (await this.client!.exists(key)) === 1;
    return this.memoryEntry(key) !== undefined;
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async incr(key: string): Promise<number> {
    if (this.isConnected) return this.client!.incr(key);
    const previous = this.memoryEntry(key);
    const next = Number(previous?.value || 0) + 1;
    this.memory.set(key, { value: String(next), expiresAt: previous?.expiresAt ?? null });
    return next;
  }

  async expire(key: string, ttlSeconds: number): Promise<void> {
    if (this.isConnected) {
      await this.client!.expire(key, ttlSeconds);
      return;
    }
    const entry = this.memoryEntry(key);
    if (entry) this.memory.set(key, { ...entry, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async scanKeys(pattern: string): Promise<string[]> {
    if (this.isConnected) {
      const keys: string[] = [];
      let cursor = '0';
      do {
        const [nextCursor, batch] = await this.client!.scan(
          cursor, 'MATCH', pattern, 'COUNT', 100,
        );
        cursor = nextCursor;
        keys.push(...batch);
      } while (cursor !== '0');
      return keys;
    }

    const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
    const matcher = new RegExp(`^${escaped}$`);
    const keys: string[] = [];
    for (const key of this.memory.keys()) {
      if (this.memoryEntry(key) && matcher.test(key)) keys.push(key);
    }
    return keys;
  }
}
