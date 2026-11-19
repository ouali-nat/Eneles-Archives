import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe, Logger } from '@nestjs/common';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Request, Response, NextFunction } from 'express';
import { corsOriginCallback } from './common/cors';
import { MetricsService } from './metrics/metrics.service';

const logger = new Logger('Bootstrap');

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    // Capture raw body for Stripe webhook signature verification
    rawBody: true,
  });

  // ─── Security Headers ──────────────────────────────────────────────────────
  app.use((_req: Request, res: Response, next: NextFunction) => {
    // Prevent clickjacking
    res.setHeader('X-Frame-Options', 'DENY');
    // Prevent MIME-type sniffing
    res.setHeader('X-Content-Type-Options', 'nosniff');
    // Stop legacy XSS filter (modern browsers ignore, but doesn't hurt)
    res.setHeader('X-XSS-Protection', '0');
    // HSTS: 1 year, includeSubDomains (only effective over HTTPS)
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    // Referrer policy: don't leak full URL to third parties
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    // Limit browser features
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=()',
    );
    // Content Security Policy: strict; AI speech feature needs media-src
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'none'",
        "script-src 'self'",
        "connect-src 'self'",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "font-src 'self'",
        "media-src 'self' blob:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
    );
    // Cross-Origin policies
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    // Remove Express fingerprint
    res.removeHeader('X-Powered-By');
    next();
  });

  // ─── Client address ─────────────────────────────────────────────────────────
  // Behind the platform's proxy every request arrives from the proxy's address,
  // so rate limits (keyed on req.ip) would be shared by everyone. Trust exactly
  // the proxy hops in front of us (one on Railway); req.ip is then the client,
  // taken from the hop the proxy appended rather than whatever the client sent.
  app.set('trust proxy', Number(process.env.TRUST_PROXY_HOPS ?? 1));

  // ─── Request Size Limits ───────────────────────────────────────────────────
  // Multer (file uploads) has its own limits set per-controller.
  // Express body-parser limits for JSON + URL-encoded payloads:
  app.use(require('express').json({ limit: '2mb' }));
  app.use(require('express').urlencoded({ extended: true, limit: '2mb' }));

  // ─── Structured Request Logging ──────────────────────────────────────────
  const metrics = app.get(MetricsService);
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    const ip = req.ip || 'unknown';

    res.on('finish', () => {
      const ms = Date.now() - start;
      // The matched pattern (/projects/:uid), never the address itself: the metric stays small and names nobody.
      const route = (req as Request & { route?: { path?: string } }).route?.path;
      if (req.path !== '/metrics') metrics.observeRequest(req.method, typeof route === 'string' ? route : 'unmatched', res.statusCode, ms / 1000);
      const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'log';
      logger[level](
        JSON.stringify({
          method: req.method,
          path: req.path,
          status: res.statusCode,
          ms,
          ip,
          ua: req.headers['user-agent']?.slice(0, 120) ?? '',
        }),
      );
    });
    next();
  });

  // ─── Global Exception Filter ────────────────────────────────────────────
  // Sanitizes 5xx responses in production (no stack traces, no SQL errors)
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ─── Global Validation Pipe ───────────────────────────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
      disableErrorMessages: false,
    }),
  );

  // ─── CORS ─────────────────────────────────────────────────────────────────
  app.enableCors({
    origin: corsOriginCallback,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    credentials: true,
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'X-File-Path', 'X-Service-Id'],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  });

  // On SIGTERM (a deploy, a restart) Nest runs every module's shutdown hooks before exiting; without this it did not, so the collaboration gateway never wrote its open documents out (CollaborationGateway.onModuleDestroy) and the last seconds of everyone's typing were lost.
  app.enableShutdownHooks();

  const port = process.env.PORT ?? 2161;
  await app.listen(port);
  logger.log(`Application running on port ${port} [env=${process.env.NODE_ENV || 'development'}]`);
}
bootstrap();
