import { Controller, Get, Header, Headers, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { timingSafeEqual } from 'crypto';
import { Public } from '../common/decorators/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../common/redis';
import { MetricsService } from './metrics.service';

/**
 * What monitoring reads.
 *
 * - `GET /health` (in AppController) answers as long as the process is up: the platform uses it to decide whether to restart the container.
 * - `GET /ready` answers 200 only when the API can do its job (the database answers). Point the uptime checker here.
 * - `GET /metrics` is the Prometheus scrape. It needs `Authorization: Bearer <METRICS_TOKEN>`; without the setting it does not exist in production.
 */
@Public()
@SkipThrottle()
@Controller()
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Get('ready')
  async ready() {
    const database = await this.prisma.healthCheck();
    const body = { status: database ? 'ready' : 'unavailable', database, redis: this.redis.isConnected };
    // Redis being down degrades the API (it falls back to memory) but does not stop it, so only the database decides.
    if (!database) throw new ServiceUnavailableException(body);
    return body;
  }

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async scrape(@Headers('authorization') authorization?: string): Promise<string> {
    const token = process.env.METRICS_TOKEN?.trim();
    if (!token) {
      if (process.env.NODE_ENV === 'production') throw new NotFoundException();
    } else {
      const given = Buffer.from(authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '');
      const expected = Buffer.from(token);
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new UnauthorizedException();
    }
    return this.metrics.render();
  }
}
