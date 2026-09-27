/**
 * HelmetMiddleware — security headers (AUTH-15).
 *
 * Plan reference: PLAN2 Section 12.4 (Security headers / Helmet),
 * OWASP Secure Headers Project.
 *
 * Sets 6 security headers per plan2 §12.4:
 *   1. `Strict-Transport-Security` — HSTS: `max-age=31536000` (1 year) +
 *      `includeSubDomains` + `preload`. Honored by browsers only over HTTPS
 *      (header is ignored over plain HTTP, no breaking in dev).
 *   2. `X-Content-Type-Options: nosniff` — disables MIME sniffing.
 *   3. `X-Frame-Options: DENY` — clickjacking protection (legacy + modern).
 *   4. `Content-Security-Policy` — restrict resource loading:
 *      `default-src 'self'`, `frame-ancestors 'none'`, `form-action 'self'`,
 *      `base-uri 'self'` (+ a few pragmatic allowances for Vue/PrimeVue).
 *   5. `Referrer-Policy: strict-origin-when-cross-origin`.
 *   6. `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`.
 *
 * Implementation: manual header setting (not using helmet() library).
 * Reason: helmet v8 has compatibility issues with NestJS middleware pipeline —
 * it can hang responses because helmet's internal request handler doesn't
 * properly call next() in some NestJS scenarios.
 * Manual header setting is more reliable + has zero dependencies.
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

/** HSTS header value — 1 year + includeSubDomains + preload. */
const HSTS_VALUE = 'max-age=31536000; includeSubDomains; preload';

/** CSP header value per plan2 §12.4. */
const CSP_VALUE = [
  "default-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
].join('; ');

/** Permissions-Policy header value per plan2 §12.4. */
const PERMISSIONS_POLICY_VALUE =
  'camera=(), microphone=(), geolocation=(), payment=()';

@Injectable()
export class HelmetMiddleware implements NestMiddleware {
  /**
   * Set 6 security headers on response, then call next().
   *
   * Manual header setting (not using helmet() library) to avoid
   * NestJS middleware pipeline compatibility issues.
   *
   * @param req - Express request (unused — headers are response-only)
   * @param res - Express response (set headers on this)
   * @param next - Next middleware
   */
  use(_req: Request, res: Response, next: NextFunction): void {
    // 1. HSTS — only honored over HTTPS, safe to set over HTTP
    res.setHeader('Strict-Transport-Security', HSTS_VALUE);

    // 2. X-Content-Type-Options: nosniff
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // 3. X-Frame-Options: DENY
    res.setHeader('X-Frame-Options', 'DENY');

    // 4. Content-Security-Policy
    res.setHeader('Content-Security-Policy', CSP_VALUE);

    // 5. Referrer-Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // 6. Permissions-Policy
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY_VALUE);

    next();
  }
}
