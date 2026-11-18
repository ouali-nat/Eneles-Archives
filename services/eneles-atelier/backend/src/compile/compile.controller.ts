import { randomBytes } from 'crypto';
import {
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { siteUrls } from '../common/site';
import { ProjectsController } from '../projects/projects.controller';
import { StorageService } from '../storage/storage.service';
import { CompileDto } from './dto/compile.dto';

/** How long the signed link to a compiled PDF lasts. */
const PDF_URL_SECONDS = 3600;
const COMPILER_TIMEOUT_MS = 120_000;

type CompilerResult = {
  success?: boolean;
  pdf?: string | null;
  log?: string;
  errors?: string[];
  duration?: number;
};

/**
 * The public compile API (docs/pages/api/compilation.mdx): `POST /compile` with LaTeX `source` or a `project_uid`, on Eneles's own compiler. A project is compiled exactly as the editor compiles it (the same route, with its access check, settings, and preamble additions). A successful compile is stored in the builds bucket and answered with a signed `pdf_url` for an hour; a document with errors is answered with 422 and its log.
 *
 * It used to forward uploaded files to the Axya service's /v1/compile, which no longer exists.
 */
@Controller('compile')
@UseGuards(ThrottlerGuard)
export class CompileController {
  private readonly logger = new Logger(CompileController.name);

  constructor(
    private readonly moduleRef: ModuleRef,
    private readonly storage: StorageService,
  ) {}

  @Post()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async compile(
    @CurrentUser() userId: number,
    @Body() body: CompileDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const started = Date.now();
    const result = body.project_uid
      ? await this.compileProject(userId, body.project_uid, body.engine)
      : await this.compileSource(body.source ?? '', body.engine);
    const compileTimeMs =
      typeof result.duration === 'number' && result.duration > 0
        ? result.duration
        : Date.now() - started;
    const logs = result.log || (result.errors ?? []).join('\n');

    if (!result.success || !result.pdf) {
      res.status(422);
      return {
        status: 'error',
        logs,
        errors: result.errors ?? [],
        compile_time_ms: compileTimeMs,
      };
    }

    const key = `api-builds/${userId}/${Date.now()}_${randomBytes(6).toString('hex')}.pdf`;
    try {
      await this.storage.uploadBuild(
        Buffer.from(result.pdf, 'base64'),
        key,
        'application/pdf',
      );
      const pdfUrl = await this.storage.getSignedUrl(
        key,
        PDF_URL_SECONDS,
        'builds',
      );
      return {
        status: 'success',
        pdf_url: pdfUrl,
        expires_at: new Date(Date.now() + PDF_URL_SECONDS * 1000).toISOString(),
        logs,
        compile_time_ms: compileTimeMs,
      };
    } catch (error) {
      this.logger.error(
        `Could not store a compiled PDF: ${(error as Error).message}`,
      );
      throw new HttpException(
        'The PDF compiled but could not be stored. Try again in a moment.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }

  /** A project, compiled by the editor's own route, so access, settings, and preamble additions are the same. */
  private async compileProject(
    userId: number,
    uid: string,
    engine?: string,
  ): Promise<CompilerResult> {
    const projects = this.moduleRef.get(ProjectsController, { strict: false });
    return (await projects.compile(
      userId,
      uid,
      engine ? { engine } : {},
    )) as CompilerResult;
  }

  /** Source on its own, as one main.tex. */
  private async compileSource(
    source: string,
    engine?: string,
  ): Promise<CompilerResult> {
    const compilerUrl = siteUrls().compiler;
    if (!compilerUrl) {
      throw new HttpException(
        'The compiler is not set up on this server: set DOMAIN_NAME or COMPILER_URL.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const secret = process.env.COMPILER_INTERNAL_SECRET;
    let response: globalThis.Response;
    try {
      response = await fetch(`${compilerUrl}/compile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(secret ? { 'X-Internal-Token': secret } : {}),
        },
        body: JSON.stringify({
          files: [{ path: 'main.tex', content: source }],
          mainFile: 'main.tex',
          engine: engine ?? 'pdflatex',
          compileMode: 'normal',
          stopOnFirstError: false,
        }),
        signal: AbortSignal.timeout(COMPILER_TIMEOUT_MS),
      });
    } catch (error) {
      const name = (error as Error)?.name;
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new HttpException(
          'The compile took too long and was stopped.',
          HttpStatus.GATEWAY_TIMEOUT,
        );
      }
      throw new HttpException(
        'The compiler is not answering. Try again in a moment.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    const result = (await response
      .json()
      .catch(() => null)) as CompilerResult | null;
    if (response.status === 429 || response.status === 503) {
      throw new HttpException(
        result?.errors?.[0] ?? 'The compiler is busy. Try again in a moment.',
        response.status === 429
          ? HttpStatus.TOO_MANY_REQUESTS
          : HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    if (!result) {
      throw new HttpException(
        'The compiler could not handle this request. Try again in a moment.',
        HttpStatus.BAD_GATEWAY,
      );
    }
    return result;
  }
}
