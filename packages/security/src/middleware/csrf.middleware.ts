/**
 * CsrfMiddleware — double-submit cookie pattern (AUTH-15).
 *
 * Plan reference: PLAN2 Section 12.3 (CSRF — double-submit cookie),
 * Section 14.6 (AUTH_MODE=disabled), Section 16 (CSRF_* env vars),
 * OWASP CSRF Prevention Cheat Sheet.
 *
 * Flow per request:
 *   1. `AUTH_MODE=disabled` → skip entirely (no cookie, no validation).
 *   2. Read `XSRF-TOKEN` cookie (via `parseSessionCookie` DRY helper).
 *      If absent → issue a fresh token cookie + expose on `res.locals`.
 *      Cookie still issues regardless of `csrfEnabled` so FE can fetch it.
 *   3. `CSRF_ENABLED=false` → skip validation, but cookie was still issued.
 *   4. Safe method (`GET`, `HEAD`, `OPTIONS`) → skip validation.
 *   5. Exempt path (`/auth/callback` default, configurable via env) → skip.
 *   6. Validate double-submit: cookie value vs `X-CSRF-Token` header via
 *      `safeEqual` (constant-time `crypto.timingSafeEqual`).
 *      - Missing cookie, missing header, or mismatch → `403 Forbidden`
 *        with body `{ statusCode: 403, message: 'Invalid CSRF token' }`.
 *
 * Single Responsibility: CSRF validation only.
 * Cookie parsing delegated to `oauth/cookie.util.ts#parseSessionCookie`.
 * Header parsing delegated to Express (`req.headers`).
 * Auth-mode / enabled flag injected via `SECURITY_OPTIONS`.
 *
 * NOTE: rotation per-session (re-issue cookie on every successful auth) is
 * deferred to AUTH-17. Here we only set the cookie when absent (first request).
 */
import {
  Inject,
  Injectable,
  Logger,
  NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { parseSessionCookie } from '../oauth/cookie.util';
import { SECURITY_OPTIONS } from '../oauth/oauth-client.service';
import type { SecurityOptions } from '../security.module';

import {
  CSRF_COOKIE_TTL_SEC,
  CSRF_EXEMPT_METHODS,
  generateCsrfToken,
  parseExemptPaths,
  safeEqual,
} from './csrf.util';

/** Cookie name — FE reads this and mirrors value as `X-CSRF-Token` header. */
const CSRF_COOKIE_NAME = 'XSRF-TOKEN';

/** Header name (case-insensitive in Express — we read lowercase). */
const CSRF_HEADER_NAME = 'x-csrf-token';

/** Standardized 403 response body for CSRF validation failure. */
const CSRF_ERROR_BODY = {
  statusCode: 403,
  message: 'Invalid CSRF token',
} as const;

@Injectable()
export class CsrfMiddleware implements NestMiddleware {
  private readonly logger = new Logger('CsrfMiddleware');
  private readonly enabled: boolean;
  private readonly authMode: SecurityOptions['authMode'];
  private readonly exemptPaths: ReadonlySet<string>;

  constructor(@Inject(SECURITY_OPTIONS) options: SecurityOptions) {
    this.enabled = options.csrfEnabled !== false; // default true
    this.authMode = options.authMode;
    this.exemptPaths = parseExemptPaths(
      process.env.CSRF_EXEMPT_PATHS,
    );
  }

  /**
   * Run the double-submit CSRF validation flow.
   *
   * Always calls `next()` on success. On validation failure, sends a `403`
   * response with a JSON body and does NOT call `next()`.
   *
   * @param req - Express request
   * @param res - Express response (used to set XSRF-TOKEN cookie + 403 body)
   * @param next - Next middleware
   */
  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    // 1. AUTH_MODE=disabled → skip entirely
    if (this.authMode === 'disabled') {
      return next();
    }

    // 2. Issue XSRF-TOKEN cookie if absent (always, even when validation off)
    const cookieToken = parseSessionCookie(req, CSRF_COOKIE_NAME);
    if (!cookieToken) {
      const fresh = generateCsrfToken();
      this.setCookie(res, fresh);
      // Expose on res.locals so controllers (e.g. GET /auth/csrf) can read it
      res.locals = res.locals ?? {};
      res.locals.csrfToken = fresh;
    }

    // 3. CSRF_ENABLED=false → skip validation, but cookie was still issued
    if (!this.enabled) return next();

    // 4. Safe methods (GET, HEAD, OPTIONS) → exempt
    if (CSRF_EXEMPT_METHODS.has(req.method.toUpperCase())) {
      return next();
    }

    // 5. Exempt paths (default /auth/callback, configurable via env)
    if (this.exemptPaths.has(req.path)) {
      return next();
    }

    // 6. Validate double-submit (cookie vs header)
    const headerToken = req.headers[CSRF_HEADER_NAME] as string | undefined;
    if (
      !cookieToken ||
      !headerToken ||
      !safeEqual(cookieToken, headerToken)
    ) {
      this.logger.warn(
        `CSRF validation failed path=${req.path} method=${req.method}`,
      );
      res.status(403).json(CSRF_ERROR_BODY);
      return;
    }

    return next();
  }

  /**
   * Set `XSRF-TOKEN` cookie on the response.
   *
   * Attributes per plan2 §12.3 + OWASP:
   *   - `HttpOnly=false` (FE JS must read this to mirror in `X-CSRF-Token` header)
   *   - `SameSite=Lax` (top-level cross-site redirect from auth still works)
   *   - `Path=/`
   *   - `Max-Age=28800` (8 hours — matches session cookie per plan2 §12.1)
   *   - `Secure` (added only when NODE_ENV=production — dev HTTP can't honor it)
   */
  private setCookie(res: Response, token: string): void {
    const parts: string[] = [
      `${CSRF_COOKIE_NAME}=${token}`,
      'HttpOnly=false',
      'SameSite=Lax',
      'Path=/',
      `Max-Age=${CSRF_COOKIE_TTL_SEC}`,
    ];
    if (process.env.NODE_ENV === 'production') {
      parts.push('Secure');
    }
    res.setHeader('Set-Cookie', parts.join('; '));
  }
}
