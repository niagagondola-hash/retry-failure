/**
 * security.config — factory untuk build SecurityOptions dari env (AUTH-17).
 *
 * Plan reference: PLAN2 Section 16 (env vars), Section 9.3 (AUTH_MODE),
 * AUTH-17 task spec §2.
 *
 * Reads process.env + builds SecurityOptions for SecurityModule.forRoot().
 *
 * Env loading: via loadEnv() helper yang adaptive (monorepo root OR
 * standalone OR OS env vars). Lihat `env-loader.ts` untuk details.
 *
 * Timing: loadEnv() dipanggil SEBELUM buildSecurityOptions() supaya
 * process.env sudah terisi saat SecurityModule di-instantiate.
 *
 * Used by:
 *   - AuthModule — `SecurityModule.forRoot(buildSecurityOptions())`
 */
import type { SecurityOptions } from '@retry-failure/security';

import { loadEnv } from './env-loader';

// Load env SEBELUM buildSecurityOptions() dipanggil.
// Adaptive: monorepo root .env (dev) OR per-app .env (Docker) OR OS env (k8s).
loadEnv();

/**
 * Build SecurityOptions from process.env.
 *
 * Reads all Plan 2 auth env vars per plan2 §16.
 *
 * @returns SecurityOptions object for SecurityModule.forRoot()
 */
export function buildSecurityOptions(): SecurityOptions {
  return {
    authMode: (process.env.AUTH_MODE ?? 'disabled') as SecurityOptions['authMode'],
    authBaseUrl: process.env.AUTH_BASE_URL,
    authIssuer: process.env.AUTH_ISSUER,
    jwtAudience: process.env.JWT_AUDIENCE ?? 'payment-api',
    oauthClientId: process.env.OAUTH_CLIENT_ID,
    oauthClientSecret: process.env.OAUTH_CLIENT_SECRET,
    oauthRedirectUri: process.env.OAUTH_REDIRECT_URI,
    oauthScopes: process.env.OAUTH_SCOPES ?? 'openid profile',
    redisUrl: process.env.REDIS_URL,

    // JWKS verifier config (plan2 §16)
    jwksCacheTtlSec: parseInt(process.env.JWKS_CACHE_TTL_SEC ?? '300', 10),
    jwtClockToleranceSec: parseInt(
      process.env.JWT_CLOCK_TOLERANCE_SEC ?? '5',
      10,
    ),

    // Session store config (plan2 §16)
    sessionStore: (process.env.SESSION_STORE ?? 'memory') as SecurityOptions['sessionStore'],

    // Lazy sync TTLs (plan2 §8.2, §16)
    syncFreshTtlMs: parseInt(process.env.SYNC_FRESH_TTL_MS ?? '300000', 10),
    syncStaleTtlMs: parseInt(process.env.SYNC_STALE_TTL_MS ?? '1800000', 10),
    syncMaxStaleTtlMs: parseInt(process.env.SYNC_MAX_STALE_TTL_MS ?? '7200000', 10),
    syncBlockingTimeoutMs: parseInt(
      process.env.SYNC_BLOCKING_TIMEOUT_MS ?? '2000',
      10,
    ),

    // AUTH_MODE=disabled config (plan2 §14.6)
    disabledUserId: process.env.AUTH_DISABLED_USER_ID,
    disabledUsername: process.env.AUTH_DISABLED_USERNAME,
    disabledRoleId: process.env.AUTH_DISABLED_ROLE_ID,
    disabledIsSuperAdmin: process.env.AUTH_DISABLED_IS_SUPER_ADMIN === 'true',
    disabledPermissionCodes: process.env.AUTH_DISABLED_PERMISSION_CODES ?? '*',

    // CSRF enabled (plan2 §12.3) — disable via env CSRF_ENABLED=false
    csrfEnabled: process.env.CSRF_ENABLED !== 'false',
  };
}
