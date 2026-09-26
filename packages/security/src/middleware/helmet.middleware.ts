/**
 * HelmetMiddleware — security headers via `helmet` (AUTH-15).
 *
 * Plan reference: PLAN2 Section 12.4 (Security headers / Helmet),
 * OWASP Secure Headers Project.
 *
 * Wraps the `helmet()` Express middleware in a NestJS `NestMiddleware` so it
 * can be applied via `consumer.apply(HelmetMiddleware).forRoutes(...)` in the
 * payment-api `AppModule`. Single Responsibility: HTTP security headers only.
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
 * Note: helmet v8 dropped the built-in `permissionsPolicy` option (the spec
 * was still in flux + the v7 API was confusing — see helmetjs/helmet#277).
 * We set the `Permissions-Policy` header manually after helmet runs, which
 * is the recommended workaround per the helmet v8 migration guide.
 *
 * `crossOriginEmbedderPolicy` is explicitly disabled because OAuth2 redirect
 * (302 from auth service to `/auth/callback`) can break under COEP.
 */
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

/**
 * Permissions-Policy header value per plan2 §12.4.
 *
 * Format: `feature=(), feature=(), ...` — empty parens disable the feature
 * for all origins. We disable: camera, microphone, geolocation, payment.
 */
const PERMISSIONS_POLICY_VALUE =
  'camera=(), microphone=(), geolocation=(), payment=()';

/**
 * Wrapper that runs helmet, then sets `Permissions-Policy` (helmet v8 dropped
 * built-in support — see class doc).
 */
type HelmetHandler = ReturnType<typeof helmet>;

@Injectable()
export class HelmetMiddleware implements NestMiddleware {
  private readonly handler: HelmetHandler;

  constructor() {
    this.handler = helmet({
      // 1. HSTS — 1 year + includeSubDomains + preload
      strictTransportSecurity: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
      // 4. CSP — restrict resource loading
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          connectSrc: ["'self'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          baseUri: ["'self'"],
        },
      },
      // 3. X-Frame-Options: DENY
      frameguard: { action: 'deny' },
      // 2. X-Content-Type-Options: nosniff
      noSniff: true,
      // 5. Referrer-Policy
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
      // Disable COEP — breaks OAuth2 redirect
      crossOriginEmbedderPolicy: false,
    });
  }

  /**
   * Apply helmet security headers to the response, then set
   * `Permissions-Policy` manually (helmet v8 dropped the built-in option).
   *
   * Delegates to the underlying `helmet()` RequestHandler for the first 5
   * headers, then adds `Permissions-Policy` via `res.setHeader`.
   *
   * @param req - Express request
   * @param res - Express response (helmet + this middleware set headers on it)
   * @param next - Next middleware
   */
  use(req: Request, res: Response, next: NextFunction): void {
    // 6. Permissions-Policy — set BEFORE helmet so helmet doesn't overwrite
    // (helmet v8 doesn't touch Permissions-Policy, so order is safe either way,
    // but setting first is defensive against future helmet versions).
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY_VALUE);
    this.handler(req, res, next);
  }
}
