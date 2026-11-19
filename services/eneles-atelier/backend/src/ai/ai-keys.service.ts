import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import {
  cleanKey,
  keyTail,
  openSecret,
  redactSecrets,
  sealSecret,
  sealingKey,
} from './ai-secrets';
import {
  PROVIDERS,
  isProviderId,
  normalizeModels,
  rankModels,
  type ModelInfo,
  type ProviderId,
} from './ai-providers';
import { checkBaseUrl, checkResolved, guardedFetch } from './url-guard';
import { KEY_CHECKS, MODEL_LISTS } from './ai-limits';

export interface StoredKey {
  provider: ProviderId;
  last4: string;
  baseUrl: string | null;
  createdAt: Date;
  lastUsedAt: Date | null;
}

export interface Credentials {
  provider: ProviderId;
  key: string;
  baseUrl: string;
  /** Requests to this base URL go through the address-checking fetch (the OpenAI-compatible provider). */
  guarded: boolean;
  /** The development exception: plain http to this machine. */
  local: boolean;
}

/** How long a model list is reused before the provider is asked again. */
const MODELS_TTL_MS = 60 * 60 * 1000;
/** A key check or model list that takes longer than this is given up. */
const LIST_TIMEOUT_MS = 12_000;

/**
 * People's own model keys. A key is checked against the provider when it is saved (one cheap call that lists models), sealed with AES-256-GCM under AI_KEY_SECRET, and stored; it is never sent back to the browser, only the provider, its last four characters, and when it was added and last used. Without AI_KEY_SECRET (32 characters or more) no key is stored, and the settings page says why.
 */
@Injectable()
export class AiKeysService {
  private readonly logger = new Logger(AiKeysService.name);
  private readonly models = new Map<
    string,
    { at: number; models: ModelInfo[] }
  >();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  get production(): boolean {
    return this.config.get<string>('NODE_ENV') === 'production';
  }

  private get secretKey(): Buffer | null {
    return sealingKey(this.config.get<string>('AI_KEY_SECRET'));
  }

  /** Whether keys can be stored on this server. */
  get canStore(): boolean {
    return this.secretKey !== null;
  }

  async list(userId: number): Promise<StoredKey[]> {
    const rows = await this.prisma.client.aiProviderKey.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return rows
      .filter((r) => isProviderId(r.provider))
      .map((r) => ({
        provider: r.provider as ProviderId,
        last4: r.last4,
        baseUrl: r.baseUrl,
        createdAt: r.createdAt,
        lastUsedAt: r.lastUsedAt,
      }));
  }

  async keySet(userId: number): Promise<Set<ProviderId>> {
    if (!this.canStore) return new Set();
    const rows = await this.prisma.client.aiProviderKey.findMany({
      where: { userId },
      select: { provider: true },
    });
    return new Set(rows.map((r) => r.provider).filter(isProviderId));
  }

  /** Checks a key with the provider, then seals and stores it, replacing the person's earlier key for that provider. */
  async save(
    userId: number,
    provider: unknown,
    rawKey: unknown,
    rawBaseUrl: unknown,
  ): Promise<StoredKey & { models: number }> {
    const secret = this.secretKey;
    if (!secret)
      throw new ServiceUnavailableException(
        'This server cannot store API keys yet: an administrator must set AI_KEY_SECRET (32 characters or more).',
      );
    if (!isProviderId(provider))
      throw new BadRequestException('Choose a provider.');
    const cleaned = cleanKey(rawKey);
    if (!cleaned.ok) throw new BadRequestException(cleaned.reason);
    const key = cleaned.key;
    const spec = PROVIDERS[provider];
    if (spec.keyPrefix && !key.startsWith(spec.keyPrefix)) {
      throw new BadRequestException(
        `${spec.name} keys start with "${spec.keyPrefix}". Check that this key is for ${spec.name}.`,
      );
    }
    const limit = KEY_CHECKS.take(userId);
    if (!limit.ok)
      throw new HttpException(
        `Too many key checks. Try again in ${limit.retryAfter} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );

    const base = await this.resolveBaseUrl(provider, rawBaseUrl);
    const credentials: Credentials = { provider, key, ...base };
    const models = await this.fetchModels(credentials);
    const sealed = sealSecret(key, secret);
    const row = await this.prisma.client.aiProviderKey.upsert({
      where: { userId_provider: { userId, provider } },
      create: {
        userId,
        provider,
        sealedKey: sealed,
        last4: keyTail(key),
        baseUrl: provider === 'compatible' ? base.baseUrl : null,
      },
      update: {
        sealedKey: sealed,
        last4: keyTail(key),
        baseUrl: provider === 'compatible' ? base.baseUrl : null,
        createdAt: new Date(),
        lastUsedAt: null,
      },
    });
    this.models.set(this.cacheKey(userId, credentials), {
      at: Date.now(),
      models,
    });
    return {
      provider,
      last4: row.last4,
      baseUrl: row.baseUrl,
      createdAt: row.createdAt,
      lastUsedAt: row.lastUsedAt,
      models: models.length,
    };
  }

  async remove(userId: number, provider: string): Promise<void> {
    if (!isProviderId(provider))
      throw new BadRequestException('Unknown provider.');
    const { count } = await this.prisma.client.aiProviderKey.deleteMany({
      where: { userId, provider },
    });
    for (const k of [...this.models.keys()])
      if (k.startsWith(`${userId}:${provider}:`)) this.models.delete(k);
    if (!count)
      throw new NotFoundException('There is no key for that provider.');
    // A default that pointed at this provider no longer can.
    await this.prisma.client.aiPreference.updateMany({
      where: { userId, provider },
      data: { provider: null, model: null },
    });
  }

  /** The person's key for `provider`, opened, or null when there is none (or it can no longer be opened). Marks it used. */
  async credentials(
    userId: number,
    provider: ProviderId,
    touch = true,
  ): Promise<Credentials | null> {
    const secret = this.secretKey;
    if (!secret) return null;
    const row = await this.prisma.client.aiProviderKey.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    if (!row) return null;
    const key = openSecret(row.sealedKey, secret);
    if (!key) {
      this.logger.warn(
        `A stored ${provider} key for account ${userId} cannot be opened (AI_KEY_SECRET changed?).`,
      );
      return null;
    }
    if (touch)
      void this.prisma.client.aiProviderKey
        .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
        .catch(() => undefined);
    const spec = PROVIDERS[provider];
    if (provider === 'compatible') {
      const check = checkBaseUrl(row.baseUrl, this.production);
      if (!check.ok) return null;
      return {
        provider,
        key,
        baseUrl: check.url,
        guarded: true,
        local: check.local,
      };
    }
    return {
      provider,
      key,
      baseUrl: spec.baseUrl!,
      guarded: false,
      local: false,
    };
  }

  /** The person's models for `provider`, best first, from the cache unless `refresh`. */
  async modelsFor(
    userId: number,
    provider: ProviderId,
    refresh = false,
  ): Promise<ModelInfo[]> {
    const credentials = await this.credentials(userId, provider, false);
    if (!credentials)
      throw new NotFoundException('Add a key for that provider first.');
    const key = this.cacheKey(userId, credentials);
    const cached = this.models.get(key);
    if (cached && !refresh && Date.now() - cached.at < MODELS_TTL_MS)
      return cached.models;
    const limit = MODEL_LISTS.take(userId);
    if (!limit.ok) {
      if (cached) return cached.models;
      throw new HttpException(
        `Too many model list requests. Try again in ${limit.retryAfter} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const models = await this.fetchModels(credentials);
    this.models.set(key, { at: Date.now(), models });
    return models;
  }

  /** What one model can do, from the cached list; null when it is not in it. */
  async modelInfo(
    userId: number,
    provider: ProviderId,
    model: string,
  ): Promise<ModelInfo | null> {
    try {
      return (
        (await this.modelsFor(userId, provider)).find((m) => m.id === model) ??
        null
      );
    } catch {
      return null;
    }
  }

  private cacheKey(userId: number, c: Credentials) {
    return `${userId}:${c.provider}:${keyTail(c.key)}:${c.baseUrl}`;
  }

  private async resolveBaseUrl(
    provider: ProviderId,
    raw: unknown,
  ): Promise<{ baseUrl: string; guarded: boolean; local: boolean }> {
    if (provider !== 'compatible')
      return {
        baseUrl: PROVIDERS[provider].baseUrl!,
        guarded: false,
        local: false,
      };
    const check = checkBaseUrl(raw, this.production);
    if (!check.ok) throw new BadRequestException(check.reason);
    const host = new URL(check.url).hostname;
    if (!check.local) {
      const resolved = await checkResolved(host, false);
      if (!resolved.ok) throw new BadRequestException(resolved.reason);
    }
    return { baseUrl: check.url, guarded: true, local: check.local };
  }

  /** Lists the models the key can use: the cheap call that proves a key works. Never puts the key or the provider's raw answer in an error. */
  async fetchModels(c: Credentials): Promise<ModelInfo[]> {
    const spec = PROVIDERS[c.provider];
    const signal = AbortSignal.timeout(LIST_TIMEOUT_MS);
    try {
      let payload: unknown;
      if (c.provider === 'anthropic') {
        const client = new Anthropic({
          apiKey: c.key,
          maxRetries: 0,
          timeout: LIST_TIMEOUT_MS,
        });
        const rows: unknown[] = [];
        for await (const model of client.models.list(
          { limit: 100 },
          { signal },
        ))
          rows.push(model);
        payload = { data: rows };
      } else if (c.provider === 'gemini') {
        payload = await this.getJson(
          'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000',
          { 'x-goog-api-key': c.key },
          signal,
          false,
        );
      } else if (c.provider === 'openrouter') {
        // The model list is public there, so the key is checked on its own first.
        await this.getJson(
          `${c.baseUrl}/key`,
          { Authorization: `Bearer ${c.key}` },
          signal,
          false,
        );
        payload = await this.getJson(
          `${c.baseUrl}/models`,
          { Authorization: `Bearer ${c.key}` },
          signal,
          false,
        );
      } else {
        payload = await this.getJson(
          `${c.baseUrl}/models`,
          { Authorization: `Bearer ${c.key}` },
          signal,
          c.guarded,
          c.local,
        );
      }
      const models = rankModels(
        c.provider,
        normalizeModels(c.provider, payload),
      );
      if (!models.length)
        throw new BadRequestException(
          `${spec.name} accepted the key but lists no chat models for it.`,
        );
      return models;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw this.listError(spec.name, err, c.key);
    }
  }

  private async getJson(
    url: string,
    headers: Record<string, string>,
    signal: AbortSignal,
    guarded: boolean,
    local = false,
  ): Promise<unknown> {
    const doFetch = guarded ? guardedFetch(local) : fetch;
    const response = await doFetch(url, {
      headers: { Accept: 'application/json', ...headers },
      signal,
      redirect: 'manual',
    });
    if (!response.ok)
      throw Object.assign(new Error(`HTTP ${response.status}`), {
        status: response.status,
      });
    return response.json();
  }

  private listError(name: string, err: unknown, key: string): HttpException {
    const e = err as {
      status?: number;
      name?: string;
      code?: string;
      message?: string;
      cause?: { code?: string };
    };
    const status = e?.status;
    if (status === 401 || status === 403)
      return new BadRequestException(
        `${name} did not accept this key. Check that it is copied whole and still active.`,
      );
    if (status === 429)
      return new HttpException(
        `${name} is limiting requests for this key. Try again in a minute.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    if (status === 404)
      return new BadRequestException(
        `${name} has no model list at that address. Check the base URL; it usually ends in /v1.`,
      );
    if (e?.name === 'TimeoutError' || e?.name === 'AbortError')
      return new HttpException(
        `${name} did not answer in time.`,
        HttpStatus.GATEWAY_TIMEOUT,
      );
    if (e?.code === 'EADDRBLOCKED' || e?.cause?.code === 'EADDRBLOCKED')
      return new BadRequestException(
        'That address is on a private or reserved network, which the server does not call.',
      );
    if (status && status >= 500)
      return new HttpException(
        `${name} had a problem (${status}). Try again later.`,
        HttpStatus.BAD_GATEWAY,
      );
    this.logger.warn(
      `Model list from ${name} failed: ${redactSecrets(String(e?.message ?? err), key)}`,
    );
    return new HttpException(
      `${name} could not be reached. Check the address and your connection.`,
      HttpStatus.BAD_GATEWAY,
    );
  }
}
