/**
 * AuthModule — wires AuthController + AuthService + SecurityModule (AUTH-17).
 *
 * Plan reference: PLAN2 Section 4.2 (BFF), Section 9 (packages/security),
 * AUTH-17 task spec §5, CODING_STANDARDS.md §Env Loading Patterns.
 *
 * Uses `SecurityModule.forRootAsync` (NOT forRoot) to avoid timing issue
 * where env vars are read BEFORE Joi validation applies defaults.
 * With forRootAsync, ConfigService is injected — env vars are read AFTER
 * Joi validation (defaults already applied). ✅
 *
 * SecurityModule.forRootAsync brings in:
 *   - SessionService + CacheRepository (from AUTH-12)
 *   - SessionGuard + MenuAccessGuard (from AUTH-13)
 *   - LazySyncMiddleware + AuthSyncService + SyncLockService (from AUTH-14)
 *   - CsrfMiddleware + HelmetMiddleware (from AUTH-15)
 *   - OAuthClientService + JwtVerifier (from AUTH-09 + AUTH-10)
 *   - TypeOrmModule.forFeature([CachedUser]) for cache table
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SecurityModule, SecurityOptions } from '@retry-failure/security';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  imports: [
    // ConfigModule already global via ConfigAppModule, but explicit import
    // ensures ConfigService is available for forRootAsync injection.
    ConfigModule,
    SecurityModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService): SecurityOptions => ({
        authMode: cfg.get<string>('AUTH_MODE') as SecurityOptions['authMode'],
        authBaseUrl: cfg.get<string>('AUTH_BASE_URL'),
        authIssuer: cfg.get<string>('AUTH_ISSUER'),
        jwtAudience: cfg.get<string>('JWT_AUDIENCE') ?? 'payment-api',
        oauthClientId: cfg.get<string>('OAUTH_CLIENT_ID'),
        oauthClientSecret: cfg.get<string>('OAUTH_CLIENT_SECRET'),
        oauthRedirectUri: cfg.get<string>('OAUTH_REDIRECT_URI'),
        oauthScopes: cfg.get<string>('OAUTH_SCOPES') ?? 'openid profile',
        redisUrl: cfg.get<string>('REDIS_URL'),
        sessionStore: cfg.get<string>('SESSION_STORE') as SecurityOptions['sessionStore'],
        jwksCacheTtlSec: cfg.get<number>('JWKS_CACHE_TTL_SEC') ?? 300,
        jwtClockToleranceSec: cfg.get<number>('JWT_CLOCK_TOLERANCE_SEC') ?? 5,
        syncFreshTtlMs: cfg.get<number>('SYNC_FRESH_TTL_MS') ?? 300000,
        syncStaleTtlMs: cfg.get<number>('SYNC_STALE_TTL_MS') ?? 1800000,
        syncMaxStaleTtlMs: cfg.get<number>('SYNC_MAX_STALE_TTL_MS') ?? 7200000,
        syncBlockingTimeoutMs:
          cfg.get<number>('SYNC_BLOCKING_TIMEOUT_MS') ?? 2000,
        disabledUserId: cfg.get<string>('AUTH_DISABLED_USER_ID'),
        disabledUsername: cfg.get<string>('AUTH_DISABLED_USERNAME'),
        disabledRoleId: cfg.get<string>('AUTH_DISABLED_ROLE_ID'),
        disabledIsSuperAdmin:
          cfg.get<string>('AUTH_DISABLED_IS_SUPER_ADMIN') === 'true',
        disabledPermissionCodes:
          cfg.get<string>('AUTH_DISABLED_PERMISSION_CODES') ?? '*',
        csrfEnabled: cfg.get<string>('CSRF_ENABLED') !== 'false',
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService, SecurityModule],
})
export class AuthModule {}
