import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface AiUsageEvent {
  userId: number;
  kind: 'chat' | 'dictation';
  provider?: string | null;
  model?: string | null;
  requests?: number;
  inputTokens?: number;
  outputTokens?: number;
  audioBytes?: number;
  durationMs?: number;
  ok?: boolean;
  /** Whose key paid: own, platform, or local (no model). */
  keySource?: 'own' | 'platform' | 'local' | null;
}

/**
 * Records how much of the paid models each person uses, so the operators can see cost and abuse. It stores counts and sizes: never a message, a file, or a transcript.
 */
@Injectable()
export class AiUsageService {
  private readonly logger = new Logger(AiUsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Never throws and never delays the answer: a failed write here must not fail the request it describes. */
  record(event: AiUsageEvent): void {
    this.prisma.client.aiUsage
      .create({
        data: {
          userId: event.userId,
          kind: event.kind,
          provider: event.provider ?? null,
          model: event.model ?? null,
          requests: event.requests ?? 1,
          inputTokens: event.inputTokens ?? 0,
          outputTokens: event.outputTokens ?? 0,
          audioBytes: event.audioBytes ?? 0,
          durationMs: event.durationMs ?? 0,
          ok: event.ok ?? true,
          keySource: event.keySource ?? null,
        },
      })
      .catch((err: unknown) =>
        this.logger.error(
          `Could not record AI usage: ${err instanceof Error ? err.message : String(err)}`,
        ),
      );
  }

  /** One person's own use over the last `days`: totals, and tokens by provider, model, and whose key paid. */
  async summaryFor(userId: number, days = 30) {
    const since = new Date(Date.now() - days * 86_400_000);
    const where = { userId, createdAt: { gte: since } };
    const [byModel, totals] = await Promise.all([
      this.prisma.client.aiUsage.groupBy({
        by: ['kind', 'provider', 'model', 'keySource'],
        where,
        _sum: {
          requests: true,
          inputTokens: true,
          outputTokens: true,
          audioBytes: true,
        },
        _count: { _all: true },
        _max: { createdAt: true },
      }),
      this.prisma.client.aiUsage.aggregate({
        where,
        _sum: { inputTokens: true, outputTokens: true },
        _count: { _all: true },
      }),
    ]);
    return {
      days,
      totals: {
        calls: totals._count._all,
        inputTokens: totals._sum.inputTokens ?? 0,
        outputTokens: totals._sum.outputTokens ?? 0,
      },
      byModel: byModel
        .map((r) => ({
          kind: r.kind,
          provider: r.provider,
          model: r.model,
          keySource: r.keySource,
          calls: r._count._all,
          requests: r._sum.requests ?? 0,
          inputTokens: r._sum.inputTokens ?? 0,
          outputTokens: r._sum.outputTokens ?? 0,
          audioBytes: r._sum.audioBytes ?? 0,
          lastUsedAt: r._max.createdAt,
        }))
        .sort(
          (a, b) =>
            b.inputTokens + b.outputTokens - (a.inputTokens + a.outputTokens) ||
            b.calls - a.calls,
        ),
    };
  }
}
