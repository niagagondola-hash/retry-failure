/**
 * SecurityModule — dynamic module for Plan 2 auth integration.
 *
 * Plan reference: PLAN2 Section 9 (packages/security), Section 9.3 (AUTH_MODE),
 * Section 9.4.4 (Pemilihan store via factory), Section 5.1 (JWKS verifier),
 * Section 16 (JWT_CLOCK_TOLERANCE_SEC, JWKS_CACHE_TTL_SEC), Section 7 (cache tables),
 * CODING_STANDARDS.md §Env Loading Patterns.
 *
 * Two registration methods:
 *   - `forRoot(options)` — synchronous, baca options langsung (BEFORE Joi validation)
 *   - `forRootAsync({ inject, useFactory })` — async, baca via ConfigService (AFTER Joi ✅)
 *
 * RECOMMENDED: Use `forRootAsync` in payment-api to avoid timing issue
 * where env vars are read BEFORE Joi applies defaults.
 *
 * Usage (recommended — forRootAsync):
 *   SecurityModule.forRootAsync({
 *     inject: [ConfigService],
 *     useFactory: (cfg: ConfigService) => ({
 *       authMode: cfg.get<string>('AUTH_MODE') ?? 'disabled',
 *       sessionStore: cfg.get<string>('SESSION_STORE') as 'redis' | 'memory',
 *       ...
 *     }),
 *   })
 *
 * Usage (legacy — forRoot, synchronous):
 *   SecurityModule.forRoot({ authMode: 'mock', sessionStore: 'memory', ... })
 *
 * Providers wired:
 *  - SECURITY_OPTIONS    : SecurityOptions value (from forRoot OR forRootAsync factory)
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
 */

import { DynamicModule, Module, Provider, Type } from '@nestjs/common';
import { TypeOrmModule, getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CacheRepository } from './cache/cache.repository';
import { CachedUser } from './cache/cached-user.entity';
import { SessionEntity } from './cache/session.entity';
import { MenuAccessGuard } from './guards/menu-access.guard';
import { SessionGuard } from './guards/session.guard';
import { CsrfMiddleware } from './middleware/csrf.middleware';
import { HelmetMiddleware } from './middleware/helmet.middleware';
import { LazySyncMiddleware } from './middleware/lazy-sync.middleware';
import { OAuthClientService, SECURITY_OPTIONS } from './oauth/oauth-client.service';
import { SessionService } from './oauth/session.service';
import {
  MemorySessionStore,
  PostgresSessionStore,
  RedisSessionStore,
  SESSION_STORE,
  WriteThroughSessionStore,
} from './session-store';
import type { SessionStore } from './session-store';
import { AuthSyncService } from './sync/auth-sync.service';
import { SyncLockService } from './sync/sync-lock.service';
import { JwksVerifier, MockVerifier, JWT_VERIFIER } from './verifiers';
import type { JwtVerifier } from './verifiers';

export interface SecurityOptions {
  authMode: 'oauth' | 'mock' | 'disabled';
  sessionStore: 'memory' | 'database' | 'redis';
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
  /** SESSION_AUDIT=true → write-through to sessions table (only when SESSION_STORE=redis). */
  sessionAudit?: boolean;
  // AUTH_MODE=disabled
  disabledUserId?: string;
  disabledUsername?: string;
  disabledRoleId?: string;
  disabledIsSuperAdmin?: boolean;
  disabledPermissionCodes?: string;
  // AUTH-14 lazy sync TTLs (env SYNC_* per plan2 §16)
  syncFreshTtlMs?: number;
  syncStaleTtlMs?: number;
  syncMaxStaleTtlMs?: number;
  syncBlockingTimeoutMs?: number;
  syncLockTtlSec?: number;
  // AUTH-15 CSRF toggle
  csrfEnabled?: boolean;
}

/** Options for forRootAsync — async factory pattern. */
export interface SecurityModuleAsyncOptions {
  /** Dependencies to inject into the factory (e.g., [ConfigService]). */
  inject?: Type<unknown>[];
  /**
   * Factory function that returns SecurityOptions (sync or async).
   * Uses `any[]` for args (NestJS convention) supaya caller bisa
   * specify typed params (e.g., `(cfg: ConfigService) => ...`).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useFactory: (...args: any[]) => SecurityOptions | Promise<SecurityOptions>;
  /** Optional extra imports (e.g., ConfigModule). */
  imports?: Type<unknown>[];
}

/** Exports list — shared between forRoot + forRootAsync. */
const EXPORTS = [
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
];

/**
 * Build providers that depend on SECURITY_OPTIONS via DI inject.
 *
 * Both forRoot + forRootAsync use this — the only difference is how
 * SECURITY_OPTIONS itself is provided (useValue vs useFactory).
 *
 * SESSION_STORE + JWT_VERIFIER inject SECURITY_OPTIONS, so they work
 * regardless of whether options came from forRoot or forRootAsync.
 */
/**
 * Build SESSION_STORE provider — selects MemorySessionStore or RedisSessionStore
 * based on SecurityOptions. For 'database' + 'redis+audit' modes, throws error
 * (must use forRootAsync which has access to Repository<SessionEntity>).
 *
 * Extracted from buildDependentProviders() to keep function under 50 lines
 * (CODING_STANDARDS.md §SRP — max-lines-per-function).
 */
function buildSessionStoreProvider(): Provider {
  return {
    provide: SESSION_STORE,
    inject: [SECURITY_OPTIONS],
    useFactory: (opts: SecurityOptions): SessionStore => {
      if (opts.sessionStore === 'memory') {
        return new MemorySessionStore();
      }
      if (opts.sessionStore === 'database') {
        throw new Error(
          'SESSION_STORE=database requires SecurityModule.forRootAsync with TypeOrmModule.forFeature([SessionEntity])',
        );
      }
      // 'redis'
      if (!opts.redisUrl) {
        throw new Error(
          'SecurityModule: SESSION_STORE="redis" requires redisUrl to be set in SecurityOptions',
        );
      }
      if (opts.sessionAudit) {
        throw new Error(
          'SESSION_AUDIT=true requires SecurityModule.forRootAsync with TypeOrmModule.forFeature([SessionEntity])',
        );
      }
      return new RedisSessionStore(opts.redisUrl);
    },
  };
}

/**
 * Build JWT_VERIFIER provider — selects MockVerifier or JwksVerifier
 * based on SecurityOptions.authMode.
 */
function buildJwtVerifierProvider(): Provider {
  return {
    provide: JWT_VERIFIER,
    inject: [SECURITY_OPTIONS],
    useFactory: (opts: SecurityOptions): JwtVerifier => {
      if (opts.authMode === 'disabled' || opts.authMode === 'mock') {
        return new MockVerifier(opts);
      }
      return new JwksVerifier(opts);
    },
  };
}

/** Build providers EXCLUDING SESSION_STORE (for forRootAsync which provides it separately). */
function buildDependentProvidersWithoutSessionStore(): Provider[] {
  return [
    buildJwtVerifierProvider(),
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
}

/** Build SESSION_STORE provider for forRootAsync — injects Repository<SessionEntity>. */
function buildAsyncSessionStoreProvider(): Provider {
  return {
    provide: SESSION_STORE,
    inject: [SECURITY_OPTIONS, getRepositoryToken(SessionEntity)],
    useFactory: (
      opts: SecurityOptions,
      sessionRepo: Repository<SessionEntity>,
    ): SessionStore => {
      if (opts.sessionStore === 'memory') {
        return new MemorySessionStore();
      }
      if (opts.sessionStore === 'database') {
        // DB only — no Redis needed
        return new PostgresSessionStore(sessionRepo);
      }
      // 'redis'
      if (!opts.redisUrl) {
        throw new Error(
          'SecurityModule: SESSION_STORE="redis" requires redisUrl to be set in SecurityOptions',
        );
      }
      const redis = new RedisSessionStore(opts.redisUrl);
      if (opts.sessionAudit) {
        // Write-through: Redis primary + DB audit
        const db = new PostgresSessionStore(sessionRepo);
        return new WriteThroughSessionStore(redis, db);
      }
      return redis;
    },
  };
}

@Module({})
export class SecurityModule {
  /**
   * Synchronous registration — baca options langsung.
   *
   * ⚠️ TIMING ISSUE: `options` harus sudah terisi saat decorator evaluate.
   * Kalau options baca `process.env`, pastikan dotenv sudah load + Joi
   * sudah apply defaults SEBELUM forRoot() dipanggil.
   *
   * RECOMMENDED: Use `forRootAsync` instead to avoid timing issues.
   */
  static forRoot(options: SecurityOptions): DynamicModule {
    return {
      module: SecurityModule,
      imports: [TypeOrmModule.forFeature([CachedUser, SessionEntity])],
      providers: [
        // SECURITY_OPTIONS — synchronous value
        { provide: SECURITY_OPTIONS, useValue: options },
        buildSessionStoreProvider(),
        ...buildDependentProvidersWithoutSessionStore(),
      ],
      exports: EXPORTS,
    };
  }

  /**
   * Async registration — baca options via factory (e.g., ConfigService).
   *
   * ✅ RECOMMENDED — avoids timing issue. Factory runs AFTER NestJS DI
   * container is ready, so ConfigService (with Joi defaults) is available.
   *
   * Usage:
   *   SecurityModule.forRootAsync({
   *     inject: [ConfigService],
   *     useFactory: (cfg: ConfigService) => ({
   *       authMode: cfg.get<string>('AUTH_MODE') ?? 'disabled',
   *       sessionStore: cfg.get<string>('SESSION_STORE') as 'redis' | 'memory',
   *     }),
   *   })
   */
  static forRootAsync(
    asyncOptions: SecurityModuleAsyncOptions,
  ): DynamicModule {
    return {
      module: SecurityModule,
      imports: [
        TypeOrmModule.forFeature([CachedUser, SessionEntity]),
        ...(asyncOptions.imports ?? []),
      ],
      providers: [
        // SECURITY_OPTIONS — async factory (runs after DI ready)
        {
          provide: SECURITY_OPTIONS,
          inject: asyncOptions.inject ?? [],
          useFactory: asyncOptions.useFactory,
        },
        // SESSION_STORE — async factory with Repository<SessionEntity> injection
        // Supports all 3 modes: memory, database, redis+audit
        buildAsyncSessionStoreProvider(),
        ...buildDependentProvidersWithoutSessionStore(),
      ],
      exports: EXPORTS,
    };
  }
}
