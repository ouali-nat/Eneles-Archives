import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { RedisService } from '../common/redis/redis.service';

export type TikzCompileBody = {
  files?: { path: string; content: string }[];
  mainFile?: string;
  engine?: string;
  stopOnFirstError?: boolean;
};

/**
 * Successful TikZ preview compiles, keyed by a hash of what was compiled. Library examples and snippets are fixed sources, so the same figure is asked for again and again; serving it from here keeps the compiler free and keeps repeat views from counting toward the endpoint's rate limit (see TikzThrottlerGuard). Redis when it is connected, otherwise a small in-process map.
 */
@Injectable()
export class TikzPreviewCache {
  private static readonly TTL_SECONDS = 7 * 24 * 60 * 60;
  private static readonly MEMORY_LIMIT = 300;
  private readonly memory = new Map<string, string>();

  constructor(private readonly redis: RedisService) {}

  key(body: TikzCompileBody | undefined): string | null {
    if (!body?.files?.length) return null;
    const material = JSON.stringify({
      files: body.files.map((f) => [f.path, f.content]),
      mainFile: body.mainFile ?? 'main.tex',
      engine: body.engine ?? 'pdflatex',
    });
    return `tikz:preview:${createHash('sha256').update(material).digest('hex')}`;
  }

  async get(key: string | null): Promise<unknown> {
    if (!key) return null;
    const raw = this.redis.isConnected
      ? await this.redis.get(key)
      : (this.memory.get(key) ?? null);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  async set(key: string | null, value: unknown): Promise<void> {
    if (!key) return;
    const raw = JSON.stringify(value);
    if (this.redis.isConnected) {
      await this.redis.set(key, raw, TikzPreviewCache.TTL_SECONDS);
      return;
    }
    if (this.memory.size >= TikzPreviewCache.MEMORY_LIMIT) {
      const oldest: string | undefined = this.memory.keys().next().value as
        string | undefined;
      if (oldest !== undefined) this.memory.delete(oldest);
    }
    this.memory.set(key, raw);
  }
}
