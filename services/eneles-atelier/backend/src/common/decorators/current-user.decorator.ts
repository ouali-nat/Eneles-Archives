import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Parameter decorator that extracts the authenticated user's ID from the request.
 *
 * The JWT auth guard attaches the decoded JWT payload to `request.user`.
 * This decorator pulls `request.user.sub` (the userId) by default,
 * or a specific property from the payload if a key is provided.
 *
 * @example
 *   // Get the userId (payload.sub)
 *   @Get('profile')
 *   getProfile(@CurrentUser() userId: number) { ... }
 *
 * @example
 *   // Get a specific field from the JWT payload
 *   @Get('profile')
 *   getProfile(@CurrentUser('email') email: string) { ... }
 */
export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      return undefined;
    }

    // If a specific property key was passed (e.g. @CurrentUser('email')),
    // return that property from the payload.
    if (data) {
      return user[data];
    }

    // Default: return the userId (payload.sub)
    return user.sub;
  },
);
