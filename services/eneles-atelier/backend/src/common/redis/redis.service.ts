import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private client: Redis;

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit() {
    const url = this.configService.get<string>('REDIS_URL');
    if (url) {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 5000),
        lazyConnect: true,
      });
    } else {
      // Fallback to individual config
      const password =
        this.configService.get<string>('REDIS_PASSWORD') || undefined;
      this.client = new Redis({
        host: this.configService.get<string>('REDIS_HOST') || 'localhost',
        port: Number(this.configService.get('REDIS_PORT')) || 6379,
        ...(password ? { password } : {}),
        db: Number(this.configService.get('REDIS_DB')) || 0,
        maxRetriesPerRequest: 3,
        retryStrategy: (times) => Math.min(times * 200, 5000),
        lazyConnect: true,
      });
    }

    this.client.on('error', (err) => {
      this.logger.error(`Redis error: ${err.message}`);
    });

    this.client.on('connect', () => {
      this.logger.log('✓ Connected to Redis');
    });

    try {
      await this.client.connect();
    } catch (err) {
      this.logger.error(`✗ Failed to connect to Redis: ${err.message}`);
      // Don't throw: allow graceful degradation to in-memory fallback
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.quit();
      this.logger.log('Redis connection closed');
    }
  }

  /** True if Redis is connected and responsive */
  get isConnected(): boolean {
    return this.client?.status === 'ready';
  }

  /** Raw ioredis client for advanced operations */
  getClient(): Redis {
    return this.client;
  }

  // ─── Key/Value with TTL ──────────────────────────────────────

  /** Set a string value with optional TTL in seconds */
  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  /** Get a string value */
  async get(key: string): Promise<string | null> {
    return this.client.get(key);
  }

  /** Delete a key */
  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  /** Check if a key exists */
  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }

  // ─── JSON helpers ────────────────────────────────────────────

  /** Store a JSON-serializable object with optional TTL in seconds */
  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  /** Retrieve and parse a JSON object (returns null if not found) */
  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  // ─── Increment / Decrement ───────────────────────────────────

  /** Increment a counter. Creates the key if it doesn't exist. */
  async incr(key: string): Promise<number> {
    return this.client.incr(key);
  }

  /** Set TTL on an existing key (seconds) */
  async expire(key: string, ttlSeconds: number): Promise<void> {
    await this.client.expire(key, ttlSeconds);
  }

  // ─── Pattern scan (for cleanup, use sparingly) ──────────────

  /** Find all keys matching a glob pattern (uses SCAN, not KEYS) */
  async scanKeys(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await this.client.scan(
        cursor,
        'MATCH',
        pattern,
        'COUNT',
        100,
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');
    return keys;
  }
}
