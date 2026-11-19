import { Injectable } from '@nestjs/common';
import { collectDefaultMetrics, Gauge, Histogram, Registry } from 'prom-client';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis';
import { collabStats } from './runtime';

/**
 * Prometheus metrics for the API: what to watch to decide when one instance is no longer enough.
 *
 * - Process: CPU, memory, event loop lag, garbage collection (the prom-client defaults).
 * - Requests: rate, errors, and duration by route.
 * - Dependencies: database pool use and waiters, whether Redis is up.
 * - Product load: connected editors and open documents, active sessions, accounts.
 *
 * Nothing here identifies a person: routes are recorded as patterns (`/projects/:uid`), never as the address that was requested.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  private readonly requests = new Histogram({
    name: 'texer_api_http_request_duration_seconds',
    help: 'How long requests take, by method, route pattern, and status class.',
    labelNames: ['method', 'route', 'status'] as const,
    buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
    registers: [this.registry],
  });

  /** Counts that need a query are read at most this often, however often Prometheus scrapes. */
  private static readonly COUNT_TTL_MS = 60_000;
  private counts: { at: number; users: number; sessions: number; projects: number } | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {
    this.registry.setDefaultLabels({ service: 'api' });
    collectDefaultMetrics({ register: this.registry, prefix: 'texer_api_' });

    const pool = new Gauge({
      name: 'texer_api_db_pool_connections',
      help: 'Database pool connections by state. Waiting above zero for long means the pool is too small or queries are too slow.',
      labelNames: ['state'] as const,
      registers: [this.registry],
      collect: () => {
        const stats = this.prisma.getPoolStats();
        pool.set({ state: 'total' }, stats.totalCount);
        pool.set({ state: 'idle' }, stats.idleCount);
        pool.set({ state: 'waiting' }, stats.waitingCount);
      },
    });

    const redisUp = new Gauge({
      name: 'texer_api_redis_up',
      help: '1 when Redis is connected, 0 when the API is running on its in-memory fallback.',
      registers: [this.registry],
      collect: () => redisUp.set(this.redis.isConnected ? 1 : 0),
    });

    const collab = new Gauge({
      name: 'texer_api_collab',
      help: 'Live collaboration: connected sockets, rooms with people in them, and documents in memory.',
      labelNames: ['kind'] as const,
      registers: [this.registry],
      collect: () => {
        const stats = collabStats();
        collab.set({ kind: 'sockets' }, stats.sockets);
        collab.set({ kind: 'rooms' }, stats.rooms);
        collab.set({ kind: 'documents' }, stats.documents);
      },
    });

    const totals = new Gauge({
      name: 'texer_api_totals',
      help: 'Accounts, active sessions, and projects.',
      labelNames: ['kind'] as const,
      registers: [this.registry],
      collect: async () => {
        const counts = await this.readCounts();
        if (!counts) return;
        totals.set({ kind: 'users' }, counts.users);
        totals.set({ kind: 'active_sessions' }, counts.sessions);
        totals.set({ kind: 'projects' }, counts.projects);
      },
    });
  }

  private async readCounts() {
    if (this.counts && Date.now() - this.counts.at < MetricsService.COUNT_TTL_MS) return this.counts;
    try {
      const [users, sessions, projects] = await Promise.all([
        this.prisma.client.user.count({ where: { accountStatus: 'active' } }),
        this.prisma.client.session.count({ where: { isActive: true, expiresAt: { gt: new Date() } } }),
        this.prisma.client.project.count({ where: { referenceOfId: null } }),
      ]);
      this.counts = { at: Date.now(), users, sessions, projects };
    } catch {
      // A scrape must not fail because the database is slow; the last values stand.
    }
    return this.counts;
  }

  /** One finished request. `route` is the pattern Express matched, so the label set stays small. */
  observeRequest(method: string, route: string, status: number, seconds: number): void {
    this.requests.observe({ method, route, status: `${Math.floor(status / 100)}xx` }, seconds);
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
