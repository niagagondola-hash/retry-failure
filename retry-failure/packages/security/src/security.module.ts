/**
 * SecurityModule — dynamic module for Plan 2 auth integration.
 *
 * Plan reference: PLAN2 Section 9 (packages/security), Section 9.3 (AUTH_MODE),
 * Section 9.4.4 (Pemilihan store via factory).
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
 *
 * Stubs to be added by AUTH-10..15 (JWKS verifier, guards, middleware, etc.).
 */

import { DynamicModule, Module } from '@nestjs/common';

import { OAuthClientService, SECURITY_OPTIONS } from './oauth/oauth-client.service';
import {
  MemorySessionStore,
  RedisSessionStore,
  SESSION_STORE,
} from './session-store';
import type { SessionStore } from './session-store';

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
      OAuthClientService,
    ];

    return {
      module: SecurityModule,
      providers,
      exports: [SECURITY_OPTIONS, SESSION_STORE, OAuthClientService],
    };
  }
}
