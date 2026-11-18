import { Controller, Get, Header } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { Public } from './common/decorators/public.decorator';
import { readFileSync } from 'fs';
import { join } from 'path';

/** The running build's version, read once from package.json (dist sits beside it). */
const VERSION: string = (() => {
  try {
    return JSON.parse(readFileSync(join(__dirname, '..', 'package.json'), 'utf8')).version;
  } catch {
    return process.env.npm_package_version || 'unknown';
  }
})();

@Public()
@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prismaService: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  /**
   * Health check endpoint for monitoring services (UptimeRobot, Better Stack, etc.)
   * Returns 200 if the API is up and the database is reachable, 503 otherwise.
   */
  @Get('health')
  async getHealth() {
    const dbHealthy = await this.prismaService.healthCheck();
    const poolStats = this.prismaService.getPoolStats();
    const uptime = process.uptime();

    const status = {
      status: dbHealthy ? 'healthy' : 'degraded',
      version: VERSION,
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      database: dbHealthy ? 'connected' : 'unreachable',
      pool: poolStats,
      timestamp: new Date().toISOString(),
    };

    return status;
  }

  /**
   * RFC 9116: security vulnerability disclosure policy.
   * https://securitytxt.org/
   */
  @Get('.well-known/security.txt')
  @Header('Content-Type', 'text/plain; charset=utf-8')
  getSecurityTxt(): string {
    return [
      'Contact: mailto:security@eneles.example',
      'Preferred-Languages: en',
      'Canonical: https://api.eneles.example/.well-known/security.txt',
      `Expires: ${new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString()}`,
      'Policy: https://eneles.example/security',
    ].join('\n');
  }
}
