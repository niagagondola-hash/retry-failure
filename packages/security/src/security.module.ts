/**
 * SecurityModule — dynamic module for Plan 2 auth integration.
 *
 * Plan reference: PLAN2 Section 9 (packages/security), Section 9.3 (AUTH_MODE),
 * Section 9.4.4 (Pemilihan store).
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
 * Stubs below will be filled by AUTH-09 to AUTH-15.
 */

import { DynamicModule, Module } from '@nestjs/common';

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
    return {
      module: SecurityModule,
      providers: [
        {
          provide: 'SECURITY_OPTIONS',
          useValue: options,
        },
        // SessionStore provider — will be added by AUTH-11
        // OAuthClientService — will be added by AUTH-09
        // JwksVerifier — will be added by AUTH-10
        // Guards — will be added by AUTH-13
        // Middleware — will be added by AUTH-14, AUTH-15
      ],
      exports: ['SECURITY_OPTIONS'],
    };
  }
}
