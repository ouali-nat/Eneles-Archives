import { siteUrls } from '../common/site';
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle } from '@nestjs/throttler';
import { TikzPreviewCache, type TikzCompileBody } from './tikz-preview.cache';
import { TikzThrottlerGuard } from './tikz-throttler.guard';
import { Public } from '../common/decorators/public.decorator';

@Public()
@UseGuards(TikzThrottlerGuard)
@Controller('tikz-compile')
export class TikzController {
  constructor(
    private readonly configService: ConfigService,
    private readonly cache: TikzPreviewCache,
  ) {}

  @Throttle({ default: { ttl: 60000, limit: 10 } })
  @Post()
  async compile(@Body() body: TikzCompileBody) {
    // A figure compiled before is served from the cache (and, through the guard, without counting toward the limit).
    const cacheKey = this.cache.key(body);
    const cached = await this.cache.get(cacheKey);
    if (cached) return cached;

    // The compiler is at compile.<DOMAIN_NAME>, or wherever COMPILER_URL says (localhost in development, a private address in production).
    const compilerUrl = siteUrls().compiler;
    if (!compilerUrl) {
      throw new HttpException(
        'The compiler is not set up on this server: set DOMAIN_NAME or COMPILER_URL.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const url = `${compilerUrl}/compile`;

    const {
      files = [],
      mainFile = 'main.tex',
      engine = 'pdflatex',
      stopOnFirstError = true,
    } = body;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Request-Source': 'tikz-preview',
          ...(this.configService.get<string>('COMPILER_INTERNAL_SECRET') && {
            'X-Internal-Token': this.configService.get<string>(
              'COMPILER_INTERNAL_SECRET',
            ),
          }),
        },
        body: JSON.stringify({
          files,
          mainFile,
          engine,
          stopOnFirstError,
          compileMode: 'normal',
        }),
        signal: AbortSignal.timeout(60_000),
      });

      const data = (await response.json()) as {
        success?: boolean;
        pdf?: string | null;
        errors?: string[];
        log?: string;
      };

      if (!response.ok) {
        throw new HttpException(
          {
            success: false,
            errors: data.errors || [data.log || 'Compilation failed'],
            pdf: null,
          },
          response.status,
        );
      }

      if (data.success && data.pdf) await this.cache.set(cacheKey, data);
      return data;
    } catch (err: unknown) {
      // The compiler's own failure (thrown just above) passes through with its status and errors.
      if (err instanceof HttpException) throw err;
      // AbortSignal.timeout() throws a DOMException with name 'TimeoutError'
      const { name, code } = (err ?? {}) as { name?: string; code?: string };
      const isTimeout = name === 'TimeoutError' || code === 'ABORT_ERR';
      throw new HttpException(
        err instanceof Error ? err.message : 'Failed to reach compiler service',
        isTimeout ? HttpStatus.GATEWAY_TIMEOUT : HttpStatus.BAD_GATEWAY,
      );
    }
  }
}
