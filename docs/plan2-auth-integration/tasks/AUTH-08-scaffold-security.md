# AUTH-08 — Scaffold `packages/security` (structure + types + module)

> **Task ID**: AUTH-08
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: -
> **Estimated effort**: S (~60 min)
> **Plan reference**: Section 9 (packages/security structure), Section 9.1 (endpoints.ts OAUTH_PATHS), Section 9.2 (AuthUser interface), Section 9.4.4 (SecurityModule.forRoot), Section 2.3 (stack)

---

## Goal

Scaffold `packages/security` sebagai library NestJS yang berisi OAuth client, session store, guards, decorators, verifiers, sync, dan cache. Task ini hanya buat **struktur folder + types + module shell**. Implementasi detail per-sub-folder diisi oleh AUTH-09 sampai AUTH-14.

## Scope

**In scope**:
- Buat folder structure sesuai plan2 section 9:
  - `src/oauth/` — `endpoints.ts` (OAUTH_PATHS konstanta), `oauth-client.service.ts` (stub), `oauth.controller.ts` (stub), `session.service.ts` (stub).
  - `src/session-store/` — `session-store.interface.ts` (Session + SessionStore interface), `redis-session.store.ts` (stub), `memory-session.store.ts` (stub).
  - `src/middleware/` — `lazy-sync.middleware.ts` (stub), `csrf.middleware.ts` (stub), `trace.middleware.ts` (stub).
  - `src/guards/` — `session.guard.ts` (stub), `jwt-auth.guard.ts` (stub), `menu-access.guard.ts` (stub).
  - `src/decorators/` — `public.decorator.ts`, `current-user.decorator.ts`, `require-menu.decorator.ts`.
  - `src/verifiers/` — `jwks-verifier.ts` (stub), `mock-verifier.ts` (stub).
  - `src/sync/` — `auth-sync.service.ts` (stub), `sync-lock.service.ts` (stub).
  - `src/cache/` — `cached-user.entity.ts` (stub), `session.entity.ts` (stub), `cache.repository.ts` (stub).
  - `src/types/` — `auth-user.ts` (AuthUser interface per plan2 section 9.2).
  - `src/security.module.ts` — `forRoot(options)` factory (per plan2 section 9.4.4).
  - `src/index.ts` — barrel export.
- `package.json` dengan dependencies: `@nestjs/common`, `@nestjs/core`, `openid-client` v5, `jose` v5, `ioredis`, `lru-cache`, `cookie-parser`, `class-validator`, `class-transformer`, `uuid`, `rxjs`.
- `tsconfig.json`, `tsconfig.build.json`, `eslint.config.mjs`, `jest.config.js`.
- Update `pnpm-workspace.yaml` (sudah include `packages/*`).
- `packages/security/src/oauth/endpoints.ts` — implementasi lengkap (konstanta sederhana).
- `packages/security/src/types/auth-user.ts` — implementasi lengkap (interface).
- `packages/security/src/security.module.ts` — implementasi `forRoot()` dengan `SecurityOptions` interface.
- `packages/security/src/index.ts` — barrel export semua stub + types + konstanta.

**Out of scope**:
- Implementasi OAuth client logic → AUTH-09.
- Implementasi JWKS verifier logic → AUTH-10.
- Implementasi SessionStore Redis + Memory → AUTH-11.
- Implementasi session.service + cookie + entity → AUTH-12.
- Implementasi guards logic → AUTH-13.
- Implementasi lazy-sync middleware → AUTH-14.
- Database migration (cached_users + sessions table) → tidak (plan2 section 7, akan ditangani terpisah di payment-api migration).

## Files to create/modify

- `packages/security/package.json`
- `packages/security/tsconfig.json`
- `packages/security/tsconfig.build.json`
- `packages/security/eslint.config.mjs`
- `packages/security/jest.config.js`
- `packages/security/src/index.ts` — barrel
- `packages/security/src/security.module.ts` — `forRoot()` factory
- `packages/security/src/security.types.ts` — `SecurityOptions` interface
- `packages/security/src/oauth/endpoints.ts` — `OAUTH_PATHS` konstanta (lengkap)
- `packages/security/src/oauth/oauth-client.service.ts` — stub
- `packages/security/src/oauth/oauth.controller.ts` — stub
- `packages/security/src/oauth/session.service.ts` — stub
- `packages/security/src/session-store/session-store.interface.ts` — `Session` + `SessionStore` (lengkap)
- `packages/security/src/session-store/redis-session.store.ts` — stub class
- `packages/security/src/session-store/memory-session.store.ts` — stub class
- `packages/security/src/middleware/lazy-sync.middleware.ts` — stub
- `packages/security/src/middleware/csrf.middleware.ts` — stub
- `packages/security/src/middleware/trace.middleware.ts` — stub
- `packages/security/src/guards/session.guard.ts` — stub
- `packages/security/src/guards/jwt-auth.guard.ts` — stub
- `packages/security/src/guards/menu-access.guard.ts` — stub
- `packages/security/src/decorators/public.decorator.ts` — implementasi lengkap (`@Public()`)
- `packages/security/src/decorators/current-user.decorator.ts` — implementasi lengkap (`@CurrentUser()`)
- `packages/security/src/decorators/require-menu.decorator.ts` — implementasi lengkap (`@RequireMenu()`)
- `packages/security/src/verifiers/jwks-verifier.ts` — stub class
- `packages/security/src/verifiers/mock-verifier.ts` — stub class
- `packages/security/src/sync/auth-sync.service.ts` — stub
- `packages/security/src/sync/sync-lock.service.ts` — stub
- `packages/security/src/cache/cached-user.entity.ts` — TypeORM entity (lengkap per plan2 section 7.1)
- `packages/security/src/cache/session.entity.ts` — TypeORM entity (lengkap per plan2 section 7.2)
- `packages/security/src/cache/cache.repository.ts` — stub
- `packages/security/src/types/auth-user.ts` — `AuthUser` interface (lengkap)
- `packages/security/README.md` — short overview
- `packages/security/test/endpoints.spec.ts` — verify OAUTH_PATHS konstanta
- `packages/security/test/auth-user.spec.ts` — verify AuthUser shape

## Implementation steps

1. Buat folder structure:
   ```bash
   cd /home/z/my-project/retry-failure
   mkdir -p packages/security/src/{oauth,session-store,middleware,guards,decorators,verifiers,sync,cache,types}
   mkdir -p packages/security/test
   ```

2. Buat `packages/security/package.json`:
   ```json
   {
     "name": "@retry-failure/security",
     "version": "0.1.0",
     "private": true,
     "description": "Auth integration package: OAuth2 client, session store, guards, lazy sync",
     "main": "src/index.ts",
     "types": "src/index.ts",
     "scripts": {
       "lint": "eslint src --ext .ts",
       "typecheck": "tsc --noEmit",
       "test": "jest"
     },
     "dependencies": {
       "@nestjs/common": "^11.0.0",
       "@nestjs/core": "^11.0.0",
       "@nestjs/axios": "^3.1.0",
       "axios": "^1.7.0",
       "class-transformer": "^0.5.1",
       "class-validator": "^0.14.1",
       "cookie-parser": "^1.4.7",
       "ioredis": "^5.4.0",
       "jose": "^5.9.0",
       "lru-cache": "^11.0.0",
       "openid-client": "^5.6.5",
       "reflect-metadata": "^0.2.2",
       "rxjs": "^7.8.1",
       "uuid": "^10.0.0"
     },
     "peerDependencies": {
       "@nestjs/common": "^11.0.0",
       "@nestjs/core": "^11.0.0",
       "typeorm": "^0.3.20"
     },
     "devDependencies": {
       "@nestjs/testing": "^11.0.0",
       "@types/express": "^4.17.21",
       "@types/jest": "^29.5.0",
       "@types/node": "^20.14.0",
       "@types/uuid": "^10.0.0",
       "jest": "^29.7.0",
       "ts-jest": "^29.2.0",
       "ts-node": "^10.9.0",
       "typescript": "^5.6.0"
     }
   }
   ```
   > Catatan: `typeorm` di peerDependencies supaya bisa dipakai di payment-api (yang sudah punya typeorm). Entity TypeORM di package ini akan di-include.

3. Buat `packages/security/tsconfig.json`:
   ```json
   {
     "extends": "../../tsconfig.base.json",
     "compilerOptions": {
       "module": "commonjs",
       "target": "es2022",
       "outDir": "./dist",
       "baseUrl": "./",
       "experimentalDecorators": true,
       "emitDecoratorMetadata": true,
       "types": ["node", "jest"]
     },
     "include": ["src/**/*"],
     "exclude": ["node_modules", "dist", "test"]
   }
   ```

4. Buat `packages/security/tsconfig.build.json`:
   ```json
   {
     "extends": "./tsconfig.json",
     "exclude": ["node_modules", "test", "dist", "**/*.spec.ts"]
   }
   ```

5. Buat `packages/security/jest.config.js` (mirror dari `packages/resilience/jest.config.js`).

6. Buat `packages/security/eslint.config.mjs` (mirror dari `packages/resilience/eslint.config.mjs`).

7. **`src/oauth/endpoints.ts`** (implementasi lengkap, per plan2 section 9.1):
   ```ts
   // packages/security/src/oauth/endpoints.ts
   export const OAUTH_PATHS = {
     authorize:   '/oauth/authorize',
     token:       '/oauth/token',
     revoke:      '/oauth/revoke',
     jwks:        '/.well-known/jwks.json',
     discovery:   '/.well-known/openid-configuration',
     permissions: '/api/v1/me/permissions',
     switchRole:  '/api/v1/auth/switch-role',
   } as const;

   export type OAuthPath = keyof typeof OAUTH_PATHS;
   ```

8. **`src/types/auth-user.ts`** (implementasi lengkap, per plan2 section 9.2):
   ```ts
   // packages/security/src/types/auth-user.ts
   export interface AuthUser {
     userId: string;
     username: string;
     roleId: string;
     isSuperAdmin: boolean;
     permissionCodes: string[];
   }
   ```

9. **`src/session-store/session-store.interface.ts`** (implementasi lengkap, per plan2 section 9.4.1):
   ```ts
   // packages/security/src/session-store/session-store.interface.ts
   export interface Session {
     sid: string;
     userId: string;
     username: string;
     roleId: string;
     permissionCodes: string[];
     accessToken: string;
     refreshToken: string;
     accessExpiresAt: number;
     refreshExpiresAt: number;
     createdAt: number;
     lastSeenAt: number;
     lastSyncAt: number;
   }

   export interface SessionStore {
     get(sid: string): Promise<Session | null>;
     set(sid: string, session: Session, ttlMs: number): Promise<void>;
     delete(sid: string): Promise<void>;
     touch(sid: string): Promise<void>;
     updateSync(sid: string, permissionCodes: string[], lastSyncAt: number): Promise<void>;
     listActive(): Promise<Session[]>;
     acquireLock(key: string, ttlSec: number): Promise<boolean>;
     releaseLock(key: string): Promise<void>;
   }
   ```

10. **`src/security.types.ts`**:
    ```ts
    // packages/security/src/security.types.ts
    export interface SecurityOptions {
      /** 'oauth' | 'mock' | 'disabled' */
      authMode: 'oauth' | 'mock' | 'disabled';
      authBaseUrl: string;
      authIssuer: string;
      jwtAudience: string;
      oauthClientId: string;
      oauthClientSecret: string;
      oauthRedirectUri: string;
      oauthScopes: string[];
      /** 'redis' | 'memory' */
      sessionStore: 'redis' | 'memory';
      redisUrl?: string;
      /** For AUTH_MODE=disabled */
      disabled?: {
        userId: string;
        username: string;
        roleId: string;
        isSuperAdmin: boolean;
        permissionCodes: string[] | '*';
      };
      jwtClockToleranceSec?: number;
      jwksCacheTtlSec?: number;
      syncFreshTtlMs?: number;
      syncStaleTtlMs?: number;
      syncMaxStaleTtlMs?: number;
      syncBlockingTimeoutMs?: number;
      syncLockTtlSec?: number;
    }
    ```

11. **`src/security.module.ts`** (implementasi `forRoot` factory, per plan2 section 9.4.4):
    ```ts
    // packages/security/src/security.module.ts
    import { DynamicModule, Module } from '@nestjs/common';
    import { SecurityOptions } from './security.types';
    import { MemorySessionStore } from './session-store/memory-session.store';
    import { RedisSessionStore } from './session-store/redis-session.store';
    import { SESSION_STORE } from './session-store/tokens';
    import { AuthSyncService } from './sync/auth-sync.service';
    import { SyncLockService } from './sync/sync-lock.service';
    import { SessionService } from './oauth/session.service';
    import { OAuthClientService } from './oauth/oauth-client.service';
    import { JwksVerifier } from './verifiers/jwks-verifier';
    import { MockVerifier } from './verifiers/mock-verifier';

    @Module({})
    export class SecurityModule {
      static forRoot(options: SecurityOptions): DynamicModule {
        const sessionStoreProvider = {
          provide: SESSION_STORE,
          useFactory: () => {
            if (options.sessionStore === 'memory') {
              return new MemorySessionStore();
            }
            return new RedisSessionStore(options.redisUrl!);
          },
        };

        return {
          module: SecurityModule,
          providers: [
            sessionStoreProvider,
            { provide: 'SECURITY_OPTIONS', useValue: options },
            AuthSyncService,
            SyncLockService,
            SessionService,
            OAuthClientService,
            JwksVerifier,
            MockVerifier,
          ],
          exports: [
            sessionStoreProvider,
            SessionService,
            OAuthClientService,
            JwksVerifier,
            MockVerifier,
            AuthSyncService,
            SyncLockService,
          ],
        };
      }
    }
    ```

12. **`src/session-store/tokens.ts`**:
    ```ts
    export const SESSION_STORE = Symbol('SESSION_STORE');
    ```

13. **`src/decorators/public.decorator.ts`** (lengkap):
    ```ts
    import { SetMetadata } from '@nestjs/common';
    export const IS_PUBLIC_KEY = 'isPublic';
    export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
    ```

14. **`src/decorators/current-user.decorator.ts`** (lengkap):
    ```ts
    import { createParamDecorator, ExecutionContext } from '@nestjs/common';
    import { AuthUser } from '../types/auth-user';
    export const CurrentUser = createParamDecorator(
      (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
        const req = ctx.switchToHttp().getRequest();
        const user = req.user as AuthUser | undefined;
        return data ? user?.[data] : user;
      },
    );
    ```

15. **`src/decorators/require-menu.decorator.ts`** (lengkap):
    ```ts
    import { SetMetadata } from '@nestjs/common';
    export const REQUIRE_MENU_KEY = 'requireMenu';
    export const RequireMenu = (...menuCodes: string[]) =>
      SetMetadata(REQUIRE_MENU_KEY, menuCodes);
    ```

16. **Stub classes** untuk service/store/guard yang belum diimplement:
    ```ts
    // src/oauth/oauth-client.service.ts
    import { Injectable } from '@nestjs/common';
    @Injectable()
    export class OAuthClientService {
      // Implementation: AUTH-09
    }
    ```
    Similar stubs for: `SessionService`, `RedisSessionStore`, `MemorySessionStore`, `JwksVerifier`, `MockVerifier`, `AuthSyncService`, `SyncLockService`, `SessionGuard`, `JwtAuthGuard`, `MenuAccessGuard`, `LazySyncMiddleware`, `CsrfMiddleware`, `TraceMiddleware`, `CacheRepository`.

17. **Stub TypeORM entities** (per plan2 section 7.1, 7.2):
    ```ts
    // src/cache/cached-user.entity.ts
    import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

    @Entity('cached_users')
    export class CachedUser {
      @PrimaryColumn('uuid') user_id!: string;
      @Column({ type: 'varchar', length: 64 }) username!: string;
      @Column({ type: 'varchar', length: 128, nullable: true }) email?: string;
      @Column({ type: 'varchar', length: 128 }) name!: string;
      @Column({ type: 'boolean', default: false }) is_super_admin!: boolean;
      @Column({ type: 'timestamp', precision: 3, name: 'last_sync_at' }) last_sync_at!: Date;
    }
    ```
    ```ts
    // src/cache/session.entity.ts
    import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn, Index } from 'typeorm';

    @Entity('sessions')
    @Index('idx_sessions_user_id', ['user_id'])
    @Index('idx_sessions_last_sync_at', ['last_sync_at'])
    @Index('idx_sessions_refresh_expires_at', ['refresh_expires_at'])
    export class SessionEntity {
      @PrimaryColumn({ type: 'varchar', length: 64 }) sid!: string;
      @Column({ type: 'uuid' }) user_id!: string;
      @Column({ type: 'uuid' }) role_id!: string;
      @Column({ type: 'jsonb' }) permission_codes!: string[];
      @Column({ type: 'text' }) access_token!: string;
      @Column({ type: 'text' }) refresh_token!: string;
      @Column({ type: 'timestamp', precision: 3 }) access_expires_at!: Date;
      @Column({ type: 'timestamp', precision: 3 }) refresh_expires_at!: Date;
      @CreateDateColumn({ type: 'timestamp', precision: 3 }) created_at!: Date;
      @Column({ type: 'timestamp', precision: 3 }) last_seen_at!: Date;
      @Column({ type: 'timestamp', precision: 3 }) last_sync_at!: Date;
    }
    ```

18. **`src/index.ts`** barrel:
    ```ts
    export * from './oauth/endpoints';
    export * from './oauth/oauth-client.service';
    export * from './oauth/session.service';
    export * from './oauth/oauth.controller';
    export * from './session-store/session-store.interface';
    export * from './session-store/redis-session.store';
    export * from './session-store/memory-session.store';
    export * from './session-store/tokens';
    export * from './middleware/lazy-sync.middleware';
    export * from './middleware/csrf.middleware';
    export * from './middleware/trace.middleware';
    export * from './guards/session.guard';
    export * from './guards/jwt-auth.guard';
    export * from './guards/menu-access.guard';
    export * from './decorators/public.decorator';
    export * from './decorators/current-user.decorator';
    export * from './decorators/require-menu.decorator';
    export * from './verifiers/jwks-verifier';
    export * from './verifiers/mock-verifier';
    export * from './sync/auth-sync.service';
    export * from './sync/sync-lock.service';
    export * from './cache/cached-user.entity';
    export * from './cache/session.entity';
    export * from './cache/cache.repository';
    export * from './types/auth-user';
    export * from './security.types';
    export * from './security.module';
    ```

19. Run `pnpm install` di root, lalu `pnpm --filter @retry-failure/security typecheck` untuk verify stub compiles.

20. Run `pnpm --filter @retry-failure/security test` untuk verify minimal spec pass.

## Acceptance criteria

- [ ] `packages/security/` ada dengan struktur folder sesuai plan2 section 9 (9 sub-folders).
- [ ] `package.json` punya semua dependencies yang dibutuhkan (openid-client v5, jose v5, ioredis, lru-cache, dll).
- [ ] `pnpm install` di root selesai tanpa error.
- [ ] `pnpm --filter @retry-failure/security typecheck` lulus (semua stub + types compile).
- [ ] `pnpm --filter @retry-failure/security lint` lulus.
- [ ] `OAUTH_PATHS` export semua 7 paths (`authorize`, `token`, `revoke`, `jwks`, `discovery`, `permissions`, `switchRole`).
- [ ] `AuthUser` interface punya 5 fields (`userId`, `username`, `roleId`, `isSuperAdmin`, `permissionCodes`).
- [ ] `Session` interface punya 11 fields per plan2 section 9.4.1.
- [ ] `SessionStore` interface punya 8 methods per plan2 section 9.4.1.
- [ ] `SecurityModule.forRoot(options)` return DynamicModule dengan `SESSION_STORE` provider (factory: memory vs redis).
- [ ] `@Public()`, `@CurrentUser()`, `@RequireMenu()` decorators dapat di-import dari `@retry-failure/security`.
- [ ] `CachedUser` + `SessionEntity` TypeORM entities dapat di-import.
- [ ] Unit test `endpoints.spec.ts` + `auth-user.spec.ts` lulus.
- [ ] `packages/security/src/index.ts` barrel export semua public symbols.

## Useful commands

```bash
# Install dependencies
cd /home/z/my-project/retry-failure && pnpm install

# Typecheck (should pass — even stubs compile)
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security typecheck

# Lint
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security lint

# Test (minimal — endpoints + auth-user shape)
cd /home/z/my-project/retry-failure && pnpm --filter @retry-failure/security test

# Verify barrel exports compile
cd /home/z/my-project/retry-failure && node -e "
const sec = require('./packages/security/src/index.ts');
console.log(Object.keys(sec).sort());
"

# Verify folder structure
find /home/z/my-project/retry-failure/packages/security/src -type f | sort

# Verify deps installed
ls /home/z/my-project/retry-failure/node_modules | grep -E "openid-client|jose|ioredis|lru-cache"
```

## Notes

- **`peerDependencies`** untuk `@nestjs/common`, `@nestjs/core`, `typeorm` — supaya tidak duplikat dengan payment-api (yang sudah punya).
- **`openid-client` v5** (bukan v6) — plan2 section 2.3 + decision log #22: v6 ESM-only rewrite, API berbeda, dokumentasi minim. Stabil di v5.
- **`jose` v5** — konsisten dengan auth-mock (AUTH-02).
- **`lru-cache` v11** — modern API (Map-based).
- **TypeORM entities** di package ini, tapi migration ada di payment-api (lihat plan2 section 7). Entitas di-include dari package supaya payment-api bisa pakai langsung.
- **Stub pattern**: setiap service/store/guard stub punya `@Injectable()` decorator + class body kosong + comment `// Implementation: AUTH-XX`. Tujuannya: barrel export compile + module providers resolvable.
- **`SECURITY_OPTIONS`** di-inject via DI token (string key). Bisa di-read oleh service via `@Inject('SECURITY_OPTIONS')`.
- **Stub `OAuthController`** — di plan2 section 4.2, BFF endpoints (`/auth/login`, `/auth/callback`, dst.) ada di payment-api, bukan di packages/security. Stub controller di sini hanya untuk scaffold; nantinya controller BFF di payment-api pakai service dari package ini. Atau, controller bisa di-export dari package supaya payment-api tinggal `@Controller('/auth')` extends. Pilih: stub kosong untuk sekarang, implementasi BFF controller di payment-api.
- Setelah task ini selesai, AUTH-09 sampai AUTH-14 bisa mulai paralel (masing-masing ngisi stub).
