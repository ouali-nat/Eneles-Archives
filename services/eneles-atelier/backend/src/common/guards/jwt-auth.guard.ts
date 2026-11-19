import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ApiKeysService } from '../../api-keys/api-keys.service';
import { AuthService, SUSPENDED_MESSAGE } from '../../auth/auth.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { cookieRequestAllowed, tokenFromHeaders } from '../session-cookie';

/** Route prefixes an API key may not reach. */
const SESSION_ONLY = ['/auth', '/api-keys', '/billing', '/settings/sessions', '/settings/2fa', '/admin'];

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly authService: AuthService,
    private readonly reflector: Reflector,
    private readonly apiKeysService: ApiKeysService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Check if the route is marked as @Public()
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: unknown }>();
    const source = tokenFromHeaders(request.headers);
    if (!source) {
      // No session: an API key in the x-api-key header authenticates as its owner.
      const apiKey = request.headers['x-api-key'];
      if (typeof apiKey === 'string' && apiKey) {
        return this.withApiKey(request, apiKey);
      }
      throw new UnauthorizedException('Sign in to continue');
    }
    if (
      source.via === 'cookie' &&
      !cookieRequestAllowed(request.method, request.headers)
    ) {
      throw new ForbiddenException('This request did not come from Eneles');
    }
    const token = source.token;

    try {
      const payload = await this.authService.validateToken(token);
      // Attach the decoded JWT payload to the request so downstream
      // handlers (and the @CurrentUser decorator) can access it.
      request.user = payload;
      return true;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      throw new UnauthorizedException('Invalid or expired token');
    }
  }

  /**
   * Authenticate a request by API key. The request then carries the same `user` shape a session produces, so handlers read `request.user.sub` either way. Keys cannot manage keys, sessions, or billing: those need the person, signed in.
   */
  private async withApiKey(
    request: Request & { user?: unknown },
    apiKey: string,
  ): Promise<boolean> {
    const path = request.path;
    if (
      SESSION_ONLY.some(
        (prefix) => path === prefix || path.startsWith(`${prefix}/`),
      )
    ) {
      throw new ForbiddenException(
        'This endpoint needs a signed-in session, not an API key',
      );
    }
    const user = await this.apiKeysService.validateApiKey(apiKey);
    if (!user) {
      throw new UnauthorizedException('Invalid API key');
    }
    // A disabled account's keys stop with it, and say why.
    if ((user as { accountStatus?: string }).accountStatus === 'suspended') {
      throw new ForbiddenException(SUSPENDED_MESSAGE);
    }
    request.user = { sub: user.id, email: user.email, name: user.name };
    return true;
  }
}
