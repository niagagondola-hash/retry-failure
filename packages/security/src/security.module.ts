/**
 * SecurityModule — dynamic module for Plan 2 auth integration.
 *
 * Plan reference: PLAN2 Section 9 (packages/security), Section 9.3 (AUTH_MODE),
 * Section 9.4.4 (Pemilihan store via factory), Section 5.1 (JWKS verifier),
 * Section 16 (JWT_CLOCK_TOLERANCE_SEC, JWKS_CACHE_TTL_SEC), Section 7 (cache tables).
 *
 * Usage in payment-api:
 *   SecurityModule.forRoot({
 *     authMode: 'mock',
 *     sessionStore: 'memory',
 *     authBaseUrl: 'http://localhost:4001',
 *     authIssuer: 'http://localhost:4001',
 *     jwtAudience: 'payment-api',
 *     oauthClientId: 'payment-api',
 *     oauthClientSecret: 'dev-client-secret',
 *     oauthRedirectUri: 'http://localhost:3001/auth/callback',
 *     oauthScopes: 'openid profile',
 *   })
 *
 * Providers wired:
 *  - SECURITY_OPTIONS    : SecurityOptions value (config from env)
 *  - SESSION_STORE       : SessionStore (Redis | Memory) via factory
 *  - OAuthClientService  : openid-client v5 wrapper (AUTH-09)
 *  - JWT_VERIFIER        : JwtVerifier (MockVerifier | JwksVerifier) via factory (AUTH-10)
 *  - SessionService      : high-level session management (AUTH-12)
 *  - CacheRepository     : TypeORM Repository for cached_users (AUTH-12)
 *  - SessionGuard        : cookie → req.user mapping (AUTH-13)
 *  - MenuAccessGuard     : permission check on req.user (AUTH-13)
 *  - AuthSyncService     : fetch fresh permissions + update cache + session (AUTH-14)
 *  - SyncLockService     : per-session distributed lock wrapper (AUTH-14)
 *  - LazySyncMiddleware  : 4-tier SWR sync middleware (AUTH-14)
 *  - CsrfMiddleware      : double-submit cookie CSRF validation (AUTH-15)
 *  - HelmetMiddleware    : security headers via `helmet` (AUTH-15)
 *
 * AUTH-15 (CSRF + helmet) providers exposed via exports so payment-api
 * `AppModule` can apply them via `consumer.apply(...)` — they are NOT
 * registered as `APP_GUARD` (consumers decide route binding).
 */

import { DynamicModule, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { CacheRepository } from './cache/cache.repository';
import { CachedUser } from './cache/cached-user.entity';
import { MenuAccessGuard } from './guards/menu-access.guard';
import { SessionGuard } from './guards/session.guard';
import { CsrfMiddleware } from './middleware/csrf.middleware';
import { HelmetMiddleware } from './middleware/helmet.middleware';
import { LazySyncMiddleware } from './middleware/lazy-sync.middleware';
import { OAuthClientService, SECURITY_OPTIONS } from './oauth/oauth-client.service';
import { SessionService } from './oauth/session.service';
import {
  MemorySessionStore,
  RedisSessionStore,
  SESSION_STORE,
} from './session-store';
import type { SessionStore } from './session-store';
import { AuthSyncService } from './sync/auth-sync.service';
import { SyncLockService } from './sync/sync-lock.service';
import { JwksVerifier, MockVerifier, JWT_VERIFIER } from './verifiers';
import type { JwtVerifier } from './verifiers';

export interface SecurityOptions {
  authMode: 'oauth' | 'mock' | 'disabled';
  sessionStore: 'redis' | 'memory';
  authBaseUrl?: string;
  authIssuer?: string;
  jwtAudience?: string;
  oauthClientId?: string;
  oauthClientSecret?: string;
  oauthRedirectUri?: string;
  oauthScopes?: string;
  redisUrl?: string;
  /** JWKS cache TTL in seconds (env JWKS_CACHE_TTL_SEC, default 300). */
  jwksCacheTtlSec?: number;
  /** JWT clock tolerance in seconds (env JWT_CLOCK_TOLERANCE_SEC, default 5). */
  jwtClockToleranceSec?: number;
  // AUTH_MODE=disabled
  disabledUserId?: string;
  disabledUsername?: string;
  disabledRoleId?: string;
  disabledIsSuperAdmin?: boolean;
  disabledPermissionCodes?: string;
  // AUTH-14 lazy sync TTLs (env SYNC_* per plan2 §16)
  /** Fresh window — no sync if `age < this` (env SYNC_FRESH_TTL_MS, default 300000). */
  syncFreshTtlMs?: number;
  /** Background-sync window — non-blocking sync if `age < this` (env SYNC_STALE_TTL_MS, default 1800000). */
  syncStaleTtlMs?: number;
  /** Max stale — invalidate session if `age >= this` (env SYNC_MAX_STALE_TTL_MS, default 7200000). */
  syncMaxStaleTtlMs?: number;
  /** Blocking sync max wait in milliseconds (env SYNC_BLOCKING_TIMEOUT_MS, default 2000). */
  syncBlockingTimeoutMs?: number;
  /** Per-session lock TTL in seconds (env SYNC_LOCK_TTL_SEC, default 10). */
  syncLockTtlSec?: number;
  // AUTH-15 CSRF toggle (env CSRF_ENABLED, default true; false skips validation
  // — cookie is still issued so FE can fetch it via GET /auth/csrf).
  /** Set to `false` to disable CSRF validation (cookie still issued). Default `true`. */
  csrfEnabled?: boolean;
}

@Module({})
export class SecurityModule {
  static forRoot(options: SecurityOptions): DynamicModule {
    const providers = [
      {
        provide: SECURITY_OPTIONS,
        useValue: options,
      },
      {
        provide: SESSION_STORE,
        useFactory: (): SessionStore => {
          if (options.sessionStore === 'memory') {
            return new MemorySessionStore();
          }
          // 'redis'
          if (!options.redisUrl) {
            throw new Error(
              'SecurityModule: SECURITY_OPTIONS.sessionStore="redis" requires SECURITY_OPTIONS.redisUrl to be set',
            );
          }
          return new RedisSessionStore(options.redisUrl);
        },
      },
      // Verifier factory — pick MockVerifier when AUTH_MODE=mock, else JwksVerifier.
      // Both share identical JWKS-fetch logic; MockVerifier is a marker subclass.
      {
        provide: JWT_VERIFIER,
        useFactory: (): JwtVerifier => {
          if (options.authMode === 'disabled') {
            // AUTH-13 SessionGuard handles disabled mode by short-circuiting
            // before calling verify(). We still return a verifier instance so
            // DI doesn't fail at boot.
            return new MockVerifier(options);
          }
          if (options.authMode === 'mock') {
            return new MockVerifier(options);
          }
          return new JwksVerifier(options);
        },
      },
      OAuthClientService,
      SessionService,
      CacheRepository,
      SessionGuard,
      MenuAccessGuard,
      AuthSyncService,
      SyncLockService,
      LazySyncMiddleware,
      CsrfMiddleware,
      HelmetMiddleware,
    ];

    return {
      module: SecurityModule,
      // TypeOrmModule.forFeature so CacheRepository can @InjectRepository(CachedUser)
      imports: [TypeOrmModule.forFeature([CachedUser])],
      providers,
      exports: [
        SECURITY_OPTIONS,
        SESSION_STORE,
        JWT_VERIFIER,
        OAuthClientService,
        SessionService,
        CacheRepository,
        SessionGuard,
        MenuAccessGuard,
        AuthSyncService,
        SyncLockService,
        LazySyncMiddleware,
        CsrfMiddleware,
        HelmetMiddleware,
        TypeOrmModule,
      ],
    };
  }
}
