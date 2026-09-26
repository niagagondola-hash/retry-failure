/**
 * SessionGuard — verify session cookie → set req.user (AUTH-13).
 *
 * Plan reference: PLAN2 Section 9.2 (req.user shape), Section 6.3 (is_super_admin source),
 * Section 14.6 (disabled mode), AUTH-13 task spec §2.
 *
 * Flow:
 *   1. AUTH_MODE=disabled → set req.user from env, return true (skip)
 *   2. @Public() decorator → return true (skip)
 *   3. Read `sid` cookie (via cookie-parser middleware or manual fallback)
 *   4. Missing cookie → 401 Unauthorized
 *   5. Lookup session via SessionService.get(sid)
 *   6. Session not found / expired → 401
 *   7. Touch session (update lastSeenAt + refresh TTL)
 *   8. Lookup cached_users via CacheRepository.findCachedUser(userId)
 *      → isSuperAdmin from cache (stable across sessions per plan2 §6.3)
 *   9. Build AuthUser from session + cached_users, set req.user
 *  10. Return true
 *
 * Single Responsibility: session cookie → req.user mapping only.
 * Permission check is delegated to MenuAccessGuard.
 */
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { CacheRepository } from '../cache/cache.repository';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { parseSessionCookie } from '../oauth/cookie.util';
import { SECURITY_OPTIONS } from '../oauth/oauth-client.service';
import { SessionService } from '../oauth/session.service';
import type { SecurityOptions } from '../security.module';
import { AuthUser } from '../types/auth-user';
import { buildDisabledUser } from '../utils/disabled-user';

@Injectable()
export class SessionGuard implements CanActivate {
  private readonly logger = new Logger('SessionGuard');

  constructor(
    private readonly sessionService: SessionService,
    private readonly cache: CacheRepository,
    private readonly reflector: Reflector,
    @Inject(SECURITY_OPTIONS) private readonly options: SecurityOptions,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    // 1. AUTH_MODE=disabled → set fake user from env, skip auth
    if (this.options.authMode === 'disabled') {
      const req = ctx.switchToHttp().getRequest<{
        user?: AuthUser;
      }>();
      req.user = buildDisabledUser();
      return true;
    }

    // 2. @Public() decorator → skip auth
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    // 3. Read `sid` cookie
    const req = ctx.switchToHttp().getRequest<
      Request & { user?: AuthUser }
    >();
    const sid = parseSessionCookie(req);
    if (!sid) {
      throw new UnauthorizedException('Missing session cookie');
    }

    // 5. Lookup session
    const session = await this.sessionService.get(sid);
    if (!session) {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // 7. Touch session (rolling TTL)
    await this.sessionService.touch(sid);

    // 8. Lookup cached_users for is_super_admin (stable across sessions)
    const cached = await this.cache.findCachedUser(session.userId);
    const isSuperAdmin = cached?.is_super_admin ?? false;

    // 9. Build AuthUser + set req.user
    req.user = {
      userId: session.userId,
      username: session.username,
      roleId: session.roleId,
      isSuperAdmin,
      permissionCodes: session.permissionCodes,
    };
    return true;
  }
}
