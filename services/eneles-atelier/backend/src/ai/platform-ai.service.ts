import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { PROVIDERS, type ProviderId } from './ai-providers';

const KEY = 'platform_ai';

export interface PlatformAiState {
  /** The operators' switch. Off by default: the assistant then works only with people's own keys. */
  enabled: boolean;
  /** A platform key is set in the environment, so the platform path could answer. */
  configured: boolean;
  /** Which provider and model the platform path uses, for the admin panel. */
  provider: ProviderId | null;
  model: string | null;
  updatedAt: Date | null;
  updatedBy: number | null;
}

export interface PlatformCredentials {
  provider: ProviderId;
  key: string;
  baseUrl: string;
  model: string;
}

/**
 * Platform AI: whether subscribers whose plan includes the assistant may use the platform's own model keys (ANTHROPIC_API_KEY, OPENAI_API_KEY) without bringing their own. Stored in the `platform_settings` table, changed only by the root administrator from the admin panel, and read here with a short cache so every assistant request does not query it.
 */
@Injectable()
export class PlatformAiService {
  private cache: {
    at: number;
    enabled: boolean;
    updatedAt: Date | null;
    updatedBy: number | null;
  } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** The platform's keys from the environment, the provider chosen by AI_CHAT_PROVIDER when both are set. */
  credentials(): PlatformCredentials | null {
    const explicit = this.config.get<string>('AI_CHAT_PROVIDER')?.toLowerCase();
    const anthropic = this.config.get<string>('ANTHROPIC_API_KEY');
    const openai = this.config.get<string>('OPENAI_API_KEY');
    const viaAnthropic = (): PlatformCredentials => ({
      provider: 'anthropic',
      key: anthropic!,
      baseUrl: PROVIDERS.anthropic.baseUrl!,
      model:
        this.config.get<string>('ANTHROPIC_CHAT_MODEL') || 'claude-opus-5-5',
    });
    const viaOpenai = (): PlatformCredentials => ({
      provider: 'openai',
      key: openai!,
      baseUrl:
        this.config.get<string>('OPENAI_BASE_URL') || PROVIDERS.openai.baseUrl!,
      model: this.config.get<string>('OPENAI_CHAT_MODEL') || 'gpt-6-luna',
    });
    if (explicit === 'anthropic' && anthropic) return viaAnthropic();
    if (explicit === 'openai' && openai) return viaOpenai();
    if (anthropic) return viaAnthropic();
    if (openai) return viaOpenai();
    return null;
  }

  async state(): Promise<PlatformAiState> {
    if (!this.cache || Date.now() - this.cache.at > 5_000) {
      const row = await this.prisma.client.platformSetting.findUnique({
        where: { key: KEY },
      });
      const value = (row?.value ?? {}) as { enabled?: unknown };
      this.cache = {
        at: Date.now(),
        enabled: value.enabled === true,
        updatedAt: row?.updatedAt ?? null,
        updatedBy: row?.updatedBy ?? null,
      };
    }
    const creds = this.credentials();
    return {
      enabled: this.cache.enabled,
      configured: !!creds,
      provider: creds?.provider ?? null,
      model: creds?.model ?? null,
      updatedAt: this.cache.updatedAt,
      updatedBy: this.cache.updatedBy,
    };
  }

  async setEnabled(
    enabled: boolean,
    actorId: number,
  ): Promise<PlatformAiState> {
    await this.prisma.client.platformSetting.upsert({
      where: { key: KEY },
      create: { key: KEY, value: { enabled }, updatedBy: actorId },
      update: { value: { enabled }, updatedBy: actorId },
    });
    this.cache = null;
    return this.state();
  }
}
