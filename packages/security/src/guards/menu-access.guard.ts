/**
 * MenuAccessGuard — check @RequireMenu metadata against user.permissionCodes (AUTH-13).
 *
 * Plan reference: PLAN2 Section 6.4 (MenuAccessGuard), Section 6.3 (is_super_admin bypass),
 * Section 14.6 (disabled mode), AUTH-13 task spec §3.
 *
 * Flow:
 *   1. AUTH_MODE=disabled → return true (skip all menu checks)
 *   2. @Public() decorator → return true (skip)
 *   3. No @RequireMenu metadata → return true (no menu required → allow)
 *   4. req.user not set → return true (SessionGuard should have set it; defer to next guard)
 *   5. user.isSuperAdmin === true → return true (bypass per plan2 §6.3)
 *   6. user.permissionCodes includes '*' → return true (wildcard)
 *   7. Check OR logic: at least one required menu in user.permissionCodes
 *   8. No match → 403 Forbidden
 *
 * Single Responsibility: permission check only.
 * Session resolution is delegated to SessionGuard.
 */
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { REQUIRE_MENU_KEY } from '../decorators/require-menu.decorator';
import { SECURITY_OPTIONS } from '../oauth/oauth-client.service';
import type { SecurityOptions } from '../security.module';
import { AuthUser } from '../types/auth-user';
import { hasPermissionForMenu } from '../utils/disabled-user';

@Injectable()
export class MenuAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(SECURITY_OPTIONS) private readonly options: SecurityOptions,
  ) {}

  canActivate(ctx: ExecutionContext): boolean {
    // 1. AUTH_MODE=disabled → skip all menu checks
    if (this.options.authMode === 'disabled') return true;

    // 2. @Public() decorator → skip
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    // 3. No @RequireMenu metadata → allow (no menu required)
    const requiredMenus = this.reflector.getAllAndOverride<string[]>(
      REQUIRE_MENU_KEY,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!requiredMenus || requiredMenus.length === 0) return true;

    // 4. req.user not set → allow (SessionGuard should have set it; defer)
    const req = ctx.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    if (!user) return true;

    // 5. Super admin bypass
    if (user.isSuperAdmin) return true;

    // 6. Wildcard permission
    if (user.permissionCodes.includes('*')) return true;

    // 7. OR logic — at least one required menu must be in permissionCodes
    const hasAccess = requiredMenus.some((code) =>
      hasPermissionForMenu(user.permissionCodes, code),
    );
    if (!hasAccess) {
      throw new ForbiddenException(
        `Missing required menu: ${requiredMenus.join(' | ')}`,
      );
    }
    return true;
  }
}
