import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response, Request } from 'express';

/**
 * Global exception filter that sanitizes error responses in production.
 *
 * In development: returns full error messages for debugging.
 * In production:  returns generic messages for 500-level errors to prevent
 *                 leaking stack traces, SQL errors, or internal service names.
 *
 * Always logs the full error internally regardless of environment.
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');
  private readonly isProduction = process.env.NODE_ENV === 'production';

  /** Text that came from the runtime or the network rather than from us: socket errors, internal addresses, stack frames, file paths. */
  private static readonly INTERNAL_DETAIL =
    /E(CONNREFUSED|CONNRESET|NOTFOUND|TIMEDOUT|AI_AGAIN|PIPE|HOSTUNREACH)\b|getaddrinfo|socket hang up|\.internal\b|\blocalhost\b|\b\d{1,3}(\.\d{1,3}){3}\b|\n\s+at |node_modules|\/(app|usr|home|var)\/|status code \d{3}|axios|fetch failed/i;

  private static readonly GENERIC: Record<number, string> = {
    502: 'A service Eneles depends on did not answer properly. Try again in a moment.',
    503: 'This part of Eneles is temporarily unavailable. Try again in a moment.',
    504: 'This took too long and was stopped. Try again in a moment.',
  };

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: number;
    let message: string | object;
    let errorName: string;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();
      message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as any).message || exceptionResponse;
      errorName = exception.name;
    } else if (exception instanceof Error) {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = exception.message;
      errorName = exception.name;
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Unknown error';
      errorName = 'UnknownError';
    }

    // ─── Always log the full error internally ──────────────────────────
    const ip = request.ip || 'unknown';

    this.logger.error(
      JSON.stringify({
        status,
        method: request.method,
        path: request.path,
        ip,
        error: errorName,
        message: typeof message === 'string' ? message : JSON.stringify(message),
        ...(exception instanceof Error && !this.isProduction
          ? { stack: exception.stack }
          : {}),
      }),
    );

    // ─── Database internals never reach a client ───────────────────────
    // Some handlers wrap a caught error's message in a 4xx. When that error
    // came from the database, its text names tables and source files.
    const text = typeof message === 'string' ? message : JSON.stringify(message);
    if (/prisma|Invalid `this\.|does not exist in the current database|PrismaClient/i.test(text)) {
      response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Something went wrong on our side. Try again in a moment.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // ─── Sanitize response in production ───────────────────────────────
    // Two kinds of 5xx reach this point. An error nobody wrote a message for (a bug, a thrown Error, a bare 500) may say anything, so its text never leaves the server. A 502, 503, or 504 raised on purpose is different: it is our own sentence about something we depend on ("The compiler refused this document: …", "arXiv has no source for this paper"), and hiding it leaves the person with nothing to act on. Those pass through, unless the text carries the fingerprints of a raw network or runtime error.
    if (this.isProduction && status >= 500) {
      const deliberate = exception instanceof HttpException && [502, 503, 504].includes(status);
      if (!deliberate || typeof message !== 'string' || GlobalExceptionFilter.INTERNAL_DETAIL.test(message)) {
        response.status(status).json({
          statusCode: status,
          message: GlobalExceptionFilter.GENERIC[status] ?? 'Something went wrong on our side. Try again in a moment.',
          // A timestamp so support can find the log entry
          timestamp: new Date().toISOString(),
        });
        return;
      }
    }

    // For 4xx errors or non-production 5xx: return the actual message
    response.status(status).json({
      statusCode: status,
      message,
      ...(status >= 500
        ? { timestamp: new Date().toISOString() }
        : {}),
    });
  }
}
