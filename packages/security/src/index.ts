// @retry-failure/security — barrel export
// Plan reference: PLAN2 Section 9 (packages/security structure)

export * from './oauth/endpoints';
export * from './oauth/pkce.util';
export * from './oauth/oauth-client.types';
export * from './oauth/oauth-client.service';
export * from './types/auth-user';
export * from './security.module';
export * from './session-store';
export * from './verifiers';

// Stubs — will be exported when implemented:
// export * from './oauth/oauth.controller';          // AUTH-17 (payment-api)
// export * from './oauth/session.service';           // AUTH-12
// export * from './middleware/lazy-sync.middleware';        // AUTH-14
// export * from './middleware/csrf.middleware';              // AUTH-15
// export * from './guards/session.guard';                   // AUTH-13
// export * from './guards/menu-access.guard';                // AUTH-13
// export * from './decorators/public.decorator';             // AUTH-13
// export * from './decorators/current-user.decorator';       // AUTH-13
// export * from './decorators/require-menu.decorator';      // AUTH-13
// export * from './sync/auth-sync.service';                  // AUTH-14
// export * from './sync/sync-lock.service';                  // AUTH-14
// export * from './cache/cached-user.entity';                // AUTH-16
// export * from './cache/session.entity';                    // AUTH-16
// export * from './cache/cache.repository';                  // AUTH-12
