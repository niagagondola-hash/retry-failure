/**
 * AuthController — BFF endpoints for OAuth2 flow + session management (AUTH-17).
 *
 * Plan reference: PLAN2 Section 4.2 (BFF endpoints), Section 12.1 (cookie attrs),
 * Section 14.6 (disabled mode), AUTH-17 task spec §4.
 *
 * 7 endpoints:
 *   GET  /auth/session     — return current user (or null)
 *   GET  /auth/login       — start OAuth2 flow (PKCE + redirect to auth)
 *   GET  /auth/callback    — handle OAuth2 callback (exchange code + create session)
 *   POST /auth/logout      — delete session + revoke token + clear cookie
 *   POST /auth/refresh     — refresh access token
 *   POST /auth/switch-role — switch active role
 *   GET  /auth/csrf        — return CSRF token (set by CsrfMiddleware)
 *
 * All endpoints marked @Public() — BFF uses cookie-based session, not JWT.
 * SessionGuard + MenuAccessGuard still apply globally via APP_GUARD, but @Public()
 * skips them for these BFF endpoints.
 *
 * AUTH_MODE=disabled behavior:
 *   - /auth/login + /auth/callback + /auth/switch-role → 501 Not Implemented
 *   - /auth/session → return fake user from env
 *   - /auth/logout → 200 OK (no-op)
 *
 * Cookie attributes (per plan2 §12.1):
 *   - sid: HttpOnly; Secure(prod); SameSite=Lax; Path=/; Max-Age=28800 (8h)
 *   - oauth_state: HttpOnly; Secure(prod); SameSite=Lax; Max-Age=300 (5min)
 *   - oauth_verifier: HttpOnly; Secure(prod); SameSite=Lax; Max-Age=300 (5min)
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Logger,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import {
  CacheRepository,
  parseSessionCookie,
  Public,
  SessionService,
} from '@retry-failure/security';

import { AuthService } from './auth.service';
import { SwitchRoleDto } from './dto/switch-role.dto';

/** Throttle config for login + callback (10 req/min per IP per plan2 §12.5). */
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

/** Session cookie TTL — 8 hours (matches refresh token TTL per plan2 §5.3). */
const SESSION_COOKIE_MAX_AGE = 8 * 60 * 60 * 1000;

/** OAuth state + verifier cookie TTL — 5 minutes (short-lived). */
const OAUTH_COOKIE_MAX_AGE = 5 * 60 * 1000;

/**
 * AuthController — BFF endpoints for OAuth2 flow + session management (AUTH-17).
 *
 * All endpoints marked @Public() — BFF uses cookie-based session, not JWT.
 * SessionGuard + MenuAccessGuard still apply globally via APP_GUARD, but @Public()
 * skips them for these BFF endpoints (which manage the session themselves).
 */
@Controller('auth')
@Public()
export class AuthController {
  private readonly logger = new Logger('AuthController');

  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly cacheRepository: CacheRepository,
  ) {}

  /**
   * GET /auth/session — return current user (or null).
   *
   * Manually reads `sid` cookie + looks up session via SessionService.
   * This is needed because @Public() skips SessionGuard (req.user not set).
   *
   * Returns:
   *   - { user: { userId, username, roleId, isSuperAdmin } } if logged in
   *   - { user: null } if not logged in (no sid cookie or session expired)
   */
  @Get('session')
  async session(
    @Req() req: Request,
  ): Promise<{ user: { userId: string; username: string; roleId: string; isSuperAdmin: boolean; permissionCodes: string[] } | null }> {
    const sid = parseSessionCookie(req);
    if (!sid) {
      this.logger.debug('GET /auth/session — no sid cookie, return user=null');
      return { user: null };
    }

    this.logger.debug(`GET /auth/session — sid=${sid.substring(0, 8)}... lookup session`);
    const session = await this.sessionService.get(sid);
    if (!session) {
      this.logger.debug(`GET /auth/session — session not found for sid=${sid.substring(0, 8)}...`);
      return { user: null };
    }

    // Lookup cached_users for isSuperAdmin (plan2 §6.3 — stable across sessions)
    this.logger.debug(`GET /auth/session — lookup cached_user for userId=${session.userId}`);
    const cached = await this.cacheRepository.findCachedUser(session.userId);
    const isSuperAdmin = cached?.is_super_admin ?? false;

    this.logger.debug(
      `GET /auth/session — return user=${session.username} roleId=${session.roleId} isSuperAdmin=${isSuperAdmin}`,
    );

    return {
      user: {
        userId: session.userId,
        username: session.username,
        roleId: session.roleId,
        isSuperAdmin,
        permissionCodes: session.permissionCodes,
      },
    };
  }

  /**
   * GET /auth/login — start OAuth2 flow.
   *
   * Flow:
   *   1. Generate PKCE + state
   *   2. Set `oauth_state` + `oauth_verifier` cookies (5min TTL, HttpOnly)
   *   3. Redirect 302 to auth /oauth/authorize?...
   *
   * AUTH_MODE=disabled → 501 Not Implemented.
   */
  @Get('login')
  @Throttle(AUTH_THROTTLE)
  async login(@Res() res: Response): Promise<void> {
    if (process.env.AUTH_MODE === 'disabled') {
      res.status(501).json({
        statusCode: 501,
        message: 'AUTH_MODE=disabled — login not available',
      });
      return;
    }

    this.logger.debug('GET /auth/login — start OAuth2 flow (generate PKCE + state)');
    const { redirectUrl, state, codeVerifier } =
      await this.authService.startLogin();

    this.logger.debug(`GET /auth/login — set oauth_state + oauth_verifier cookies (5min TTL) + redirect to: ${redirectUrl.substring(0, 80)}...`);

    const isProd = process.env.NODE_ENV === 'production';
    const cookieOpts = {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax' as const,
      maxAge: OAUTH_COOKIE_MAX_AGE,
    };

    res.cookie('oauth_state', state, cookieOpts);
    res.cookie('oauth_verifier', codeVerifier, cookieOpts);
    res.redirect(302, redirectUrl);
  }

  /**
   * GET /auth/callback — handle OAuth2 callback.
   *
   * Flow:
   *   1. Read `code` + `state` from query
   *   2. Read `oauth_state` + `oauth_verifier` from cookies
   *   3. Verify state matches (CSRF protection)
   *   4. Exchange code → verify JWT → fetch permissions → create session
   *   5. Set `sid` cookie (8h TTL)
   *   6. Clear `oauth_state` + `oauth_verifier` cookies
   *   7. Redirect 302 to `/` (frontend)
   *
   * AUTH_MODE=disabled → 501 Not Implemented.
   */
  @Get('callback')
  @Throttle(AUTH_THROTTLE)
  async callback(
    @Req()
    req: Request & {
      query: { code?: string; state?: string };
      cookies?: Record<string, string>;
    },
    @Res() res: Response,
  ): Promise<void> {
    if (process.env.AUTH_MODE === 'disabled') {
      res.status(501).json({
        statusCode: 501,
        message: 'AUTH_MODE=disabled — callback not available',
      });
      return;
    }

    const FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

    const { code, state } = req.query;
    const expectedState = req.cookies?.oauth_state;
    const codeVerifier = req.cookies?.oauth_verifier;

    this.logger.debug(
      `GET /auth/callback — code=${code ? 'present' : 'missing'} state=${state ? 'present' : 'missing'} ` +
      `oauth_state_cookie=${expectedState ? 'present' : 'missing'} oauth_verifier_cookie=${codeVerifier ? 'present' : 'missing'}`,
    );

    if (!code || !state || !expectedState || !codeVerifier) {
      this.logger.warn('GET /auth/callback — missing code/state/cookies, return 400');
      res.status(400).json({
        statusCode: 400,
        message: 'Missing code, state, or oauth cookies',
      });
      return;
    }

    try {
      this.logger.debug('GET /auth/callback — call authService.handleCallback (verify state + exchange code + verify JWT + fetch perms + create session)');
      const { sid, user } = await this.authService.handleCallback(
        code,
        state,
        expectedState,
        codeVerifier,
      );

      const isProd = process.env.NODE_ENV === 'production';
      this.logger.debug(`GET /auth/callback — set sid cookie (8h TTL) for user=${user.username}, redirect to FE`);
      res.cookie('sid', sid, {
        httpOnly: true,
        secure: isProd,
        sameSite: 'lax',
        maxAge: SESSION_COOKIE_MAX_AGE,
        path: '/',
      });
      res.clearCookie('oauth_state');
      res.clearCookie('oauth_verifier');
      this.logger.debug(`GET /auth/callback — redirect to: ${FRONTEND_URL}`);
      res.redirect(302, FRONTEND_URL);
      void user; // user info available via /auth/session after redirect
    } catch (err) {
      this.logger.warn(`GET /auth/callback — handleCallback failed: ${(err as Error).message}`);
      res.status(401).json({
        statusCode: 401,
        message: (err as Error).message,
      });
    }
  }

  /**
   * POST /auth/logout — delete session + revoke token + clear cookie.
   *
   * AUTH_MODE=disabled → 200 OK (no-op).
   */
  @Post('logout')
  @HttpCode(200)
  async logout(
    @Req()
    req: Request & { cookies?: Record<string, string> },
    @Res() res: Response,
  ): Promise<void> {
    const sid = req.cookies?.sid;
    if (!sid) {
      res.json({ statusCode: 200, message: 'OK (no session)' });
      return;
    }

    try {
      const { endSessionUrl } = await this.authService.logout(sid);
      res.clearCookie('sid', { path: '/' });
      res.json({ statusCode: 200, endSessionUrl });
    } catch (err) {
      this.logger.warn(`POST /auth/logout — logout failed: ${(err as Error).message}`);
      res.clearCookie('sid', { path: '/' });
      res.status(500).json({
        statusCode: 500,
        message: 'Logout failed — please try again',
      });
    }
  }

  /**
   * POST /auth/refresh — refresh access token.
   *
   * Reads `sid` from cookie, refreshes token via OAuthClientService,
   * updates session in-place.
   */
  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Req()
    req: Request & { cookies?: Record<string, string> },
  ): Promise<{ ok: true }> {
    const sid = req.cookies?.sid;
    if (!sid) {
      throw new UnauthorizedException('Missing session cookie');
    }
    await this.authService.refresh(sid);
    return { ok: true };
  }

  /**
   * POST /auth/switch-role — switch active role.
   *
   * Body: { roleId: "<uuid>" }
   * Response: { user: AuthUser }
   *
   * AUTH_MODE=disabled → 501 Not Implemented.
   */
  @Post('switch-role')
  @HttpCode(200)
  async switchRole(
    @Req()
    req: Request & { cookies?: Record<string, string> },
    @Body() dto: SwitchRoleDto,
    @Res() res: Response,
  ): Promise<void> {
    if (process.env.AUTH_MODE === 'disabled') {
      res.status(501).json({
        statusCode: 501,
        message: 'AUTH_MODE=disabled — switch-role not available',
      });
      return;
    }

    const sid = req.cookies?.sid;
    if (!sid) {
      throw new UnauthorizedException('Missing session cookie');
    }

    const user = await this.authService.switchRole(sid, dto.roleId);
    res.json({ user });
  }

  /**
   * GET /auth/csrf — return CSRF token.
   *
   * CsrfMiddleware sets `res.locals.csrfToken` on every request.
   * Frontend reads it from this endpoint for SPA initial load.
   *
   * Uses `@Res({ passthrough: true })` so NestJS still handles the response
   * serialization (return value → JSON body), but we can access `res.locals`.
   */
  @Get('csrf')
  async csrf(
    @Res({ passthrough: true }) res: Response & { locals?: { csrfToken?: string } },
  ): Promise<{ csrfToken: string }> {
    return { csrfToken: res.locals?.csrfToken ?? '' };
  }
}
