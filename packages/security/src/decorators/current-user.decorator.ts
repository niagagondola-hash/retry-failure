/**
 * @CurrentUser() decorator — extracts req.user (or specific field) in route handler.
 *
 * Plan reference: PLAN2 Section 9.5 (decorators), Section 9.2 (req.user shape), AUTH-13 task spec §4.
 *
 * Usage:
 *   @Get('me')
 *   @UseGuards(SessionGuard)
 *   getMe(@CurrentUser() user: AuthUser) { ... }
 *
 *   @Get('me/id')
 *   @UseGuards(SessionGuard)
 *   getMyId(@CurrentUser('userId') userId: string) { ... }
 *
 * Requires SessionGuard to set req.user before handler is called.
 */
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import { AuthUser } from '../types/auth-user';

/**
 * Extract `req.user` (AuthUser) or a specific field of it.
 *
 * @param field - Optional field name (e.g. 'userId', 'username'). If omitted, returns full AuthUser.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{
      user?: AuthUser;
    }>();
    const user = request.user;
    if (!user) return undefined;
    if (!data) return user;
    return user[data];
  },
);
