# AUTH-13 — security — Guards (SessionGuard + MenuAccessGuard + decorators)

> **Task ID**: AUTH-13
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-12
> **Estimated effort**: M (~2-3 jam)
> **Plan reference**: Section 6.4 (MenuAccessGuard flow), Section 9.3 (AUTH_MODE), Section 9.3.1 (disabled behavior), Section 9.3.2 (guard production), Section 6.2 (mapping endpoint → menu), Section 6.3 (super admin), Section 6.4 (guard does NOT call auth service)

---

## Goal

Implementasi `SessionGuard` (cookie `sid` → `req.user` dari session store) + `MenuAccessGuard` (permission check via `@RequireMenu` decorator + super admin bypass). Termasuk `AUTH_MODE=disabled` behavior (skip guard, set `req.user` dari env fake user).

## Scope

**In scope**:
- `SessionGuard` (`packages/security/src/guards/session.guard.ts`):
  - Baca cookie `sid` dari request (via `cookie-parser` middleware atau manual parse).
  - `SessionStore.get(sid)` → Session atau null.
  - Bila session expired → 401.
  - Bila session valid → set `req.user = AuthUser` (merge JWT claims dari session + `permissionCodes` dari session + `isSuperAdmin` dari `cached_users` atau dari permissionCodes star).
  - Touch session (`store.touch`) untuk update `lastSeenAt`.
  - **`AUTH_MODE=disabled`**: skip guard, set `req.user` dari env `AUTH_DISABLED_USER_ID`, `AUTH_DISABLED_USERNAME`, dll.
- `MenuAccessGuard` (`packages/security/src/guards/menu-access.guard.ts`):
  - Baca `@RequireMenu('payment.write')` metadata via Reflector.
  - Bila endpoint `@Public()` → skip.
  - Bila `req.user.isSuperAdmin` → allow (bypass).
  - Bila `req.user.permissionCodes` contains required menu code → allow.
  - Bila `AUTH_DISABLED_PERMISSION_CODES='*'` → allow all.
  - Else → 403.
  - **`AUTH_MODE=disabled`**: skip guard (all endpoints allowed).
- Decorators (sudah dari AUTH-08 — verify):
  - `@Public()` — skip SessionGuard + MenuAccessGuard.
  - `@CurrentUser()` — param decorator untuk extract `req.user`.
  - `@RequireMenu(code)` — set metadata untuk MenuAccessGuard.
- Production check (plan2 section 9.3.2): kalau `NODE_ENV=production` + `AUTH_MODE in ['mock', 'disabled']` → throw error di bootstrap.
- Unit test dengan execution context mock.

**Out of scope**:
- Lazy sync middleware → AUTH-14.
- BFF controller endpoints (`/auth/login`, `/auth/callback`) → payment-api (separate task).
- JWT verification di SessionGuard → tidak, JWT verify di BFF callback (gunakan `JwksVerifier`). SessionGuard baca sid cookie → session store (yang sudah punya JWT + permissionCodes).
- Refresh token rotation logic → AUTH-09.

## Files to create/modify

- `packages/security/src/guards/session.guard.ts` — full implementation
- `packages/security/src/guards/menu-access.guard.ts` — full implementation
- `packages/security/src/guards/jwt-auth.guard.ts` — stub (tidak dipakai di plan2 BFF; plan2 pakai SessionGuard yang verify session, bukan JWT langsung)
- `packages/security/src/decorators/public.decorator.ts` — verify (sudah dari AUTH-08)
- `packages/security/src/decorators/current-user.decorator.ts` — verify
- `packages/security/src/decorators/require-menu.decorator.ts` — verify
- `packages/security/src/guards/index.ts` — barrel
- `packages/security/src/security.module.ts` — wire guards as providers (APP_GUARD optional, atau di-controller @UseGuards)
- `packages/security/src/utils/disabled-user.ts` — helper untuk build fake AuthUser dari env
- `packages/security/test/session.guard.spec.ts`
- `packages/security/test/menu-access.guard.spec.ts`
- `packages/security/test/auth-mode-disabled.spec.ts` — verify disabled behavior

## Implementation steps

1. **`disabled-user.ts`** — helper:
   ```ts
   import { AuthUser } from '../types/auth-user';

   export function buildDisabledUser(env: NodeJS.ProcessEnv = process.env): AuthUser {
     const permissionCodesRaw = env.AUTH_DISABLED_PERMISSION_CODES ?? '*';
     return {
       userId: env.AUTH_DISABLED_USER_ID ?? '00000000-0000-0000-0000-000000000001',
       username: env.AUTH_DISABLED_USERNAME ?? 'disabled-user',
       roleId: env.AUTH_DISABLED_ROLE_ID ?? '00000000-0000-0000-0000-000000000002',
       isSuperAdmin: env.AUTH_DISABLED_IS_SUPER_ADMIN === 'true',
       permissionCodes: permissionCodesRaw === '*' ? ['*'] : permissionCodesRaw.split(',').map(s => s.trim()),
     };
   }

   export function hasPermissionForMenu(permissionCodes: string[], menuCode: string): boolean {
     if (permissionCodes.includes('*')) return true;
     return permissionCodes.includes(menuCode);
   }
   ```

2. **`session.guard.ts`**:
   ```ts
   import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Inject, Logger } from '@nestjs/common';
   import { Reflector } from '@nestjs/core';
   import { Request } from 'express';
   import { SessionService } from '../oauth/session.service';
   import { AuthUser } from '../types/auth-user';
   import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
   import { buildDisabledUser } from '../utils/disabled-user';
   import { SecurityOptions } from '../security.types';
   import { CacheRepository } from '../cache/cache.repository';

   @Injectable()
   export class SessionGuard implements CanActivate {
     private readonly logger = new Logger('SessionGuard');

     constructor(
       private readonly sessionService: SessionService,
       private readonly cache: CacheRepository,
       private readonly reflector: Reflector,
       @Inject('SECURITY_OPTIONS') private readonly options: SecurityOptions,
     ) {}

     async canActivate(ctx: ExecutionContext): Promise<boolean> {
       // AUTH_MODE=disabled: skip, set fake user
       if (this.options.authMode === 'disabled') {
         const req = ctx.switchToHttp().getRequest();
         req.user = buildDisabledUser();
         return true;
       }

       // @Public() decorator: skip
       const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
         ctx.getHandler(), ctx.getClass(),
       ]);
       if (isPublic) return true;

       const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
       const cookies = (req as any).cookies ?? parseCookies(req.headers.cookie);
       const sid = cookies[this.options.sessionCookieName ?? 'sid'];
       if (!sid) throw new UnauthorizedException('Missing session cookie');

       const session = await this.sessionService.get(sid);
       if (!session) throw new UnauthorizedException('Invalid or expired session');

       // Touch session (update lastSeenAt, refresh TTL)
       await this.sessionService.touch(sid);

       // Build AuthUser from session + cached_users
       const cached = await this.cache.findCachedUser(session.userId);
       const isSuperAdmin = cached?.is_super_admin ?? false;

       req.user = {
         userId: session.userId,
         username: session.username,
         roleId: session.roleId,
         isSuperAdmin,
         permissionCodes: session.permissionCodes,
       };
       return true;
     }
   }

   function parseCookies(raw: string | undefined): Record<string, string> {
     if (!raw) return {};
     const out: Record<string, string> = {};
     for (const part of raw.split(';')) {
       const [k, v] = part.trim().split('=');
       if (k && v) out[k] = v;
     }
     return out;
   }
   ```

3. **`menu-access.guard.ts`**:
   ```ts
   import { CanActivate, ExecutionContext, Injectable, ForbiddenException, Inject } from '@nestjs/common';
   import { Reflector } from '@nestjs/core';
   import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
   import { REQUIRE_MENU_KEY } from '../decorators/require-menu.decorator';
   import { AuthUser } from '../types/auth-user';
   import { hasPermissionForMenu } from '../utils/disabled-user';
   import { SecurityOptions } from '../security.types';

   @Injectable()
   export class MenuAccessGuard implements CanActivate {
     constructor(
       private readonly reflector: Reflector,
       @Inject('SECURITY_OPTIONS') private readonly options: SecurityOptions,
     ) {}

     canActivate(ctx: ExecutionContext): boolean {
       // AUTH_MODE=disabled: skip all menu checks
       if (this.options.authMode === 'disabled') return true;

       // @Public() decorator: skip
       const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
         ctx.getHandler(), ctx.getClass(),
       ]);
       if (isPublic) return true;

       const requiredMenus = this.reflector.getAllAndOverride<string[]>(REQUIRE_MENU_KEY, [
         ctx.getHandler(), ctx.getClass(),
       ]);
       if (!requiredMenus || requiredMenus.length === 0) return true; // no menu required → allow

       const req = ctx.switchToHttp().getRequest();
       const user = req.user as AuthUser | undefined;
       if (!user) return true; // SessionGuard should have set req.user; if not, allow (let next guard handle)

       // Super admin bypass (plan2 section 6.3)
       if (user.isSuperAdmin) return true;

       // Wildcard permission (AUTH_DISABLED_PERMISSION_CODES='*')
       if (user.permissionCodes.includes('*')) return true;

       // Check at least one required menu is in permissionCodes (OR logic)
       const hasAccess = requiredMenus.some(code => hasPermissionForMenu(user.permissionCodes, code));
       if (!hasAccess) {
         throw new ForbiddenException(`Missing required menu: ${requiredMenus.join(' | ')}`);
       }
       return true;
     }
   }
   ```

4. **Verify decorators** (dari AUTH-08):
   - `public.decorator.ts` — `@Public()` set `isPublic: true` metadata.
   - `current-user.decorator.ts` — `@CurrentUser()` extract `req.user` (atau field).
   - `require-menu.decorator.ts` — `@RequireMenu(...codes)` set `requireMenu: codes` metadata.

5. **`jwt-auth.guard.ts`** (stub di AUTH-08) — document bahwa tidak dipakai di plan2 BFF:
   ```ts
   import { Injectable } from '@nestjs/common';

   /**
    * JWT Auth Guard — NOT USED in Plan 2 BFF architecture.
    *
    * Plan 2 uses SessionGuard (cookie sid → session store) instead of direct JWT verification per request.
    * JWT is verified only at OAuth callback (via JwksVerifier) — after that, session is the source of truth.
    *
    * This stub kept for future use cases (e.g., machine-to-machine API tokens).
    */
   @Injectable()
   export class JwtAuthGuard {
     // Implementation: out of scope for Plan 2.
   }
   ```

6. **Wire guards di `SecurityModule.forRoot`**:
   ```ts
   providers: [
     // ... existing
     SessionGuard,
     MenuAccessGuard,
   ],
   exports: [SessionGuard, MenuAccessGuard],
   ```
   > Catatan: guards tidak dipasang sebagai `APP_GUARD` (global) — biar controller bisa pilih per-endpoint. Pakai `@UseGuards(SessionGuard, MenuAccessGuard)` di controller payment-api.

7. **Unit test `session.guard.spec.ts`**:
   - Mock `SessionService` + `CacheRepository` + `Reflector`.
   - Test:
     - `AUTH_MODE=disabled` → set `req.user` dari env, return true.
     - `@Public()` → return true, tidak baca cookie.
     - Tanpa cookie sid → 401.
     - Cookie sid valid + session ada → set `req.user`, return true, `touch` called.
     - Cookie sid valid + session tidak ada → 401.
     - `cached_users.is_super_admin=true` → `req.user.isSuperAdmin = true`.

8. **Unit test `menu-access.guard.spec.ts`**:
   - Mock `Reflector`.
   - Test:
     - `AUTH_MODE=disabled` → return true (skip).
     - `@Public()` → return true (skip).
     - Tanpa `@RequireMenu` → return true (no menu required).
     - `@RequireMenu('payment.write')` + user punya `payment.write` → return true.
     - `@RequireMenu('payment.write')` + user TIDAK punya → 403.
     - `@RequireMenu('payment.write')` + user `isSuperAdmin=true` → return true (bypass).
     - `@RequireMenu('payment.write', 'payment.admin')` + user punya salah satu → return true (OR logic).
     - User dengan `permissionCodes: ['*']` (wildcard) → return true.
     - `req.user` undefined → return true (let SessionGuard handle).

9. **Unit test `auth-mode-disabled.spec.ts`**:
   - Test `buildDisabledUser(env)`:
     - Default values bila env kosong.
     - `AUTH_DISABLED_IS_SUPER_ADMIN=true` → `isSuperAdmin: true`.
     - `AUTH_DISABLED_PERMISSION_CODES='*'` → `permissionCodes: ['*']`.
     - `AUTH_DISABLED_PERMISSION_CODES='payment.read,payment.write'` → `permissionCodes: ['payment.read', 'payment.write']`.
   - Test production check (separate function):
     - `NODE_ENV=production` + `AUTH_MODE=mock` → throw.
     - `NODE_ENV=production` + `AUTH_MODE=disabled` → throw.
     - `NODE_ENV=production` + `AUTH_MODE=oauth` → OK.

10. **Production check** — tambahkan di payment-api `main.ts` bootstrap (atau di `SecurityModule.forRoot` constructor):
    ```ts
    function assertProductionSafety(options: SecurityOptions, nodeEnv: string) {
      if (nodeEnv === 'production') {
        if (options.authMode === 'mock') {
          throw new Error('AUTH_MODE=mock tidak boleh di production');
        }
        if (options.authMode === 'disabled') {
          throw new Error('AUTH_MODE=disabled tidak boleh di production');
        }
        if (options.sessionStore === 'memory') {
          throw new Error('SESSION_STORE=memory tidak boleh di production');
        }
      }
    }
    ```

## Acceptance criteria

- [ ] `SessionGuard.canActivate` membaca cookie `sid` + lookup session via `SessionService.get`.
- [ ] Session valid → set `req.user` (AuthUser dengan `userId`, `username`, `roleId`, `isSuperAdmin` dari cached_users, `permissionCodes` dari session).
- [ ] Session valid → `SessionService.touch` dipanggil (update lastSeenAt + refresh TTL).
- [ ] Cookie `sid` missing → 401 Unauthorized.
- [ ] Session tidak ada / expired → 401.
- [ ] `@Public()` decorator → skip guard (return true).
- [ ] `AUTH_MODE=disabled` → skip guard, set `req.user` dari env (fake user).
- [ ] `MenuAccessGuard.canActivate` baca `@RequireMenu` metadata.
- [ ] `@RequireMenu('payment.write')` + user punya `payment.write` → allow.
- [ ] `@RequireMenu('payment.write')` + user TIDAK punya → 403 Forbidden.
- [ ] `req.user.isSuperAdmin === true` → bypass (allow all).
- [ ] `@RequireMenu('payment.write', 'payment.admin')` → OR logic (salah satu cukup).
- [ ] `permissionCodes: ['*']` → wildcard, allow all.
- [ ] `AUTH_MODE=disabled` → MenuAccessGuard skip (semua allowed).
- [ ] Production check throw bila `NODE_ENV=production` + `AUTH_MODE in ['mock', 'disabled']` ATAU `SESSION_STORE=memory`.
- [ ] `@CurrentUser()` decorator extract `req.user` (atau field specific via `@CurrentUser('userId')`).
- [ ] Unit test `session.guard.spec.ts`, `menu-access.guard.spec.ts`, `auth-mode-disabled.spec.ts` lulus.
- [ ] `pnpm --filter @retry-failure/security typecheck` + `lint` lulus.

## Useful commands

```bash
# Typecheck
cd  && pnpm --filter @retry-failure/security typecheck

# Lint
cd  && pnpm --filter @retry-failure/security lint

# Run guard tests
cd  && pnpm --filter @retry-failure/security test -- --testPathPattern="(session.guard|menu-access.guard|auth-mode-disabled)"

# Run all security tests
cd  && pnpm --filter @retry-failure/security test

# Example usage in payment-api controller (reference):
# @Controller('payments')
# @UseGuards(SessionGuard, MenuAccessGuard)
# export class PaymentsController {
#   @Get()
#   @RequireMenu('payment.read')
#   list(@CurrentUser() user: AuthUser) {
#     return this.payments.list({ userId: user.userId });
#   }
#
#   @Post()
#   @RequireMenu('payment.write')
#   create(@Body() dto: CreatePaymentDto, @CurrentUser('userId') userId: string) {
#     return this.payments.create(dto, userId);
#   }
# }

# Test AUTH_MODE=disabled manually (bila payment-api sudah integrate)
# AUTH_MODE=disabled pnpm --filter payment-api start:dev
# curl http://localhost:3001/payments
# Expected: 200 (no auth check, fake user from env)

# Test production check
# NODE_ENV=production AUTH_MODE=mock pnpm --filter payment-api start:dev
# Expected: throw error at bootstrap: "AUTH_MODE=mock tidak boleh di production"
```

## Notes

- **Guard tidak global** (bukan `APP_GUARD`) — biar controller fleksibel:
  - Controller yang butuh auth → `@UseGuards(SessionGuard, MenuAccessGuard)`.
  - Controller publik (health, docs) → tidak pakai guard.
  - Endpoint tertentu → `@Public()` di method.
- **Guard order**: `SessionGuard` → `MenuAccessGuard`. SessionGuard set `req.user`, MenuAccessGuard read `req.user`. Bila terbalik, MenuAccessGuard tidak punya `req.user` → allow (false-positive).
- **`isSuperAdmin` dari `cached_users`** (bukan dari JWT):
  - JWT tipis — hanya `sub` + `username` + `roleId`.
  - `isSuperAdmin` stabil lintas sesi → disimpan di `cached_users` table (plan2 section 7.1).
  - SessionGuard lookup `cached_users` per request.
  - Lazy sync (AUTH-14) refresh `cached_users.is_super_admin` saat auth update.
- **Super admin bypass** (plan2 section 6.3):
  - `isSuperAdmin === true` → allow semua endpoint.
  - Bukan dari JWT (security: tidak bisa di-forge).
  - Bukan dari `permissionCodes: ['*']` (different mechanism).
- **`@RequireMenu` OR logic**: `@RequireMenu('payment.write', 'payment.admin')` → user cukup punya salah satu. Untuk AND logic (semua required), pakai 2 decorators atau compose di controller method.
- **Production check** (plan2 section 9.3.2):
  - `AUTH_MODE=mock` + production → throw.
  - `AUTH_MODE=disabled` + production → throw.
  - `SESSION_STORE=memory` + production → throw.
  - Check di `SecurityModule.forRoot` constructor atau payment-api `main.ts` bootstrap.
- **`JwtAuthGuard` stub** — plan2 BFF tidak pakai JWT per-request (session-based). JWT hanya di OAuth callback. Stub di-keep untuk future use case (e.g., machine-to-machine API).
- Setelah task ini selesai, AUTH-14 (lazy sync middleware) bisa mulai — pakai `SessionService.updateSync` + `OAuthClientService.fetchPermissions`.
