import {
  Injectable,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { PrismaClient } from '../../generated/prisma';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private pool: Pool;

  // Create a new instance directly in the service with proper connection pooling for scale
  public readonly client: PrismaClient;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      min: 2,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // Railway's Postgres proxy uses certs not in Node's default CA bundle.
      // rejectUnauthorized: false is standard for Railway. The connection is
      // already encrypted and routed through their private network.
      ssl: { rejectUnauthorized: false },
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    });

    // Log pool errors instead of crashing
    this.pool.on('error', (err) => {
      this.logger.error(`Pool background error: ${err.message}`);
    });

    // Create Prisma adapter with the pool
    const adapter = new PrismaPg(this.pool);

    // Create Prisma client, kept lean with no $extends overhead
    this.client = new PrismaClient({
      adapter,
      log: [
        { level: 'error', emit: 'event' },
      ],
    });

    // Only log errors (not warnings, which reduces noise)
    (this.client as any).$on?.('error', (e: any) => {
      this.logger.error(e.message);
    });
  }

  async onModuleInit() {
    try {
      this.logger.log('Initializing database connection pool...');
      await this.client.$connect();

      // Warm up the pool by acquiring min connections eagerly
      const warmupClients = await Promise.all(
        Array.from({ length: 2 }, () => this.pool.connect()),
      );
      // Release them back immediately. They stay in the pool as idle connections
      warmupClients.forEach((c) => c.release());

      this.logger.log('✓ Database connection pool ready (pre-warmed)');
      await this.checkMigrated();
    } catch (error) {
      this.logger.error(`✗ Database connection failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * A database the migrations never ran on has no tables, and every request
   * then fails with "table does not exist". Say so once, plainly, at start.
   */
  private async checkMigrated() {
    try {
      const { rows } = await this.pool.query<{ users: string | null; migrations: string | null }>(
        "select to_regclass('atelier.users') as users, to_regclass('atelier._prisma_migrations') as migrations",
      );
      if (!rows[0]?.users) {
        this.logger.error(
          'This database has no Eneles tables: the migrations have not been applied. ' +
            'Run `npx prisma migrate deploy` in backend/ with the same DATABASE_URL, then restart.',
        );
        return;
      }
      if (rows[0]?.migrations) {
        const pending = await this.pool.query<{ n: string }>(
          'select count(*)::text as n from atelier._prisma_migrations where finished_at is null and rolled_back_at is null',
        );
        if (Number(pending.rows[0]?.n) > 0) {
          this.logger.error('A migration started but did not finish. Check `npx prisma migrate status`.');
        }
      }
    } catch (err: unknown) {
      this.logger.warn(`Could not check the database schema: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async onModuleDestroy() {
    try {
      this.logger.log('Closing database connection pool...');
      await this.client.$disconnect();
      await this.pool.end();
      this.logger.log('✓ Database connection pool closed');
    } catch (error) {
      this.logger.error(
        `✗ Error closing database connections: ${error.message}`,
      );
    }
  }

  /**
   * Health check for monitoring systems
   */
  async healthCheck(): Promise<boolean> {
    try {
      await this.client.$queryRaw`SELECT 1`;
      return true;
    } catch (error) {
      this.logger.error(`Health check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Get connection pool stats for monitoring
   */
  getPoolStats() {
    return {
      totalCount: this.pool.totalCount,
      idleCount: this.pool.idleCount,
      waitingCount: this.pool.waitingCount,
      timestamp: new Date().toISOString(),
    };
  }
}
