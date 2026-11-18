import { ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { Request } from 'express';
import { TikzPreviewCache, type TikzCompileBody } from './tikz-preview.cache';

/**
 * The TikZ preview endpoint's rate limit, which only counts requests that actually reach the compiler. A figure already in the cache is served without counting, so browsing the library does not run into the limit.
 */
@Injectable()
export class TikzThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly cache: TikzPreviewCache,
  ) {
    super(options, storage, reflector);
  }

  protected async shouldSkip(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const body = request.body as TikzCompileBody | undefined;
    return (await this.cache.get(this.cache.key(body))) !== null;
  }
}
