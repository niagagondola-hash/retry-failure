/**
 * Middleware barrel — cross-cutting NestJS middleware (AUTH-14, AUTH-15).
 *
 * Plan reference: PLAN2 Section 8.4 (middleware vs guard), Section 12.3 (CSRF),
 * Section 12.4 (Helmet).
 *
 * - `LazySyncMiddleware` (AUTH-14) — stale-while-revalidate session sync.
 * - `CsrfMiddleware` (AUTH-15) — double-submit cookie CSRF validation.
 * - `HelmetMiddleware` (AUTH-15) — security headers via `helmet`.
 * - `csrf.util` (AUTH-15) — `generateCsrfToken` + `safeEqual` + exempt sets.
 *
 * Consumers (e.g. `apps/payment-api/src/app.module.ts`) apply them via:
 *   consumer
 *     .apply(HelmetMiddleware, CsrfMiddleware, LazySyncMiddleware)
 *     .forRoutes({ path: '*', method: RequestMethod.ALL });
 */
export * from './csrf.middleware';
export * from './csrf.util';
export * from './helmet.middleware';
export * from './lazy-sync.middleware';
