/**
 * SecurityModule — dynamic module for Plan 2 auth integration.
 *
 * Plan reference: PLAN2 Section 9 (packages/security), Section 9.3 (AUTH_MODE),
 * Section 9.4.4 (Pemilihan store via factory), Section 5.1 (JWKS verifier),
 * Section 16 (JWT_CLOCK_TOLERANCE_SEC, JWKS_CACHE_TTL_SEC).
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
 * Providers wired in this file (current state of Plan2 Batch 2 implementation):
 *  - SECURITY_OPTIONS  : SecurityOptions value (config from env)
 *  - SESSION_STORE     : SessionStore (RedisSessionStore | MemorySessionStore)
 *                        selected via `options.sessionStore` factory.
 *  - OAuthClientService: openid-client v5 wrapper (AUTH-09).
 *  - JWT_VERIFIER      : JwtVerifier (MockVerifier | JwksVerifier) selected
 *                        via `options.authMode` factory (AUTH-10).
 *
 * Stubs to be added by AUTH-13..15 (guards, middleware, etc.).
 */

import { DynamicModule, Module } from '@nestjs/common';

import { OAuthClientService, SECURITY_OPTIONS } from './oauth/oauth-client.service';
import {
  MemorySessionStore,
  RedisSessionStore,
  SESSION_STORE,
} from './session-store';
import type { SessionStore } from './session-store';
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
    ];

    return {
      module: SecurityModule,
      providers,
      exports: [SECURITY_OPTIONS, SESSION_STORE, JWT_VERIFIER, OAuthClientService],
    };
  }
}
