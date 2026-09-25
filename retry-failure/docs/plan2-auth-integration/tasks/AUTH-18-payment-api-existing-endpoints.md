# AUTH-18 — payment-api existing endpoints update (@RequireMenu + AUTH_MODE=disabled + bootstrap validation)

> **Task ID**: AUTH-18
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-13, AUTH-17
> **Estimated effort**: M (~2 jam)
> **Plan reference**: Section 6.2 (Mapping endpoint → menu), Section 6.4 (MenuAccessGuard), Section 9.3 (AUTH_MODE), Section 9.3.1 (Behavior AUTH_MODE=disabled), Section 9.3.2 (Guard production), Section 16 (bootstrap validation)

---

## Goal

Update existing endpoint di `apps/payment-api` (dari Plan1) supaya terintegrasi dengan `MenuAccessGuard`:
1. Tambah `@RequireMenu()` decorator sesuai mapping endpoint → menu per plan2 section 6.2.
2. Tambah `@Public()` di endpoint yang publik (`/health`, `/metrics`, `/docs`).
3. Wire `MenuAccessGuard` sebagai global APP_GUARD.
4. Implement `AUTH_MODE=disabled` behavior: `SessionGuard` + `MenuAccessGuard` skip, set `req.user` dari env (fake user).
5. Bootstrap validation function (`validateConfig`) di `main.ts`.

## Scope

**In scope**:
- Update `PaymentsController` (`apps/payment-api/src/payments/payments.controller.ts`):
  - `POST /payments` → `@RequireMenu('payment.write')`.
  - `GET /payments` → `@RequireMenu('payment.read')`.
  - `GET /payments/:id` → `@RequireMenu('payment.read')`.
  - `POST /payments/:id/retry` → `@RequireMenu('payment.retry')`.
- Update `GatewayConfigController` (admin):
  - `GET /admin/gateway-config` → `@RequireMenu('payment.admin')`.
- Update `HealthController`:
  - `GET /health` → `@Public()`.
- Update `MetricsController` (Prometheus):
  - `GET /metrics` → `@Public()`.
- Update Swagger docs (if exists):
  - `GET /docs` → `@Public()`.
- `SessionGuard` (`packages/security/src/guards/session.guard.ts`) — UPDATE (dari stub AUTH-13):
  - Bila `AUTH_MODE=disabled`: skip guard, set `req.user` dari env vars (`AUTH_DISABLED_*`).
  - Bila `@Public()` decorator present: skip guard.
  - Else: baca cookie `sid` → `SessionService.get(sid)` → set `req.user`. Bila session tidak ada → `401 Unauthorized`.
- `MenuAccessGuard` (`packages/security/src/guards/menu-access.guard.ts`) — UPDATE (dari stub AUTH-13):
  - Bila `AUTH_MODE=disabled`: skip guard (semua endpoint diizinkan).
  - Bila `@Public()` present: skip guard.
  - Bila user `isSuperAdmin=true`: skip menu check (plan2 section 6.3).
  - Bila `@RequireMenu(...)` not present: allow (no menu required).
  - Else: check `req.user.permissionCodes` contains required code → 200 / 403.
- `AUTH_MODE=disabled` env vars (per plan2 section 9.3.1):
  - `AUTH_DISABLED_USER_ID=00000000-0000-0000-0000-000000000001`.
  - `AUTH_DISABLED_USERNAME=disabled-user`.
  - `AUTH_DISABLED_ROLE_ID=00000000-0000-0000-0000-000000000002`.
  - `AUTH_DISABLED_IS_SUPER_ADMIN=true` (default).
  - `AUTH_DISABLED_PERMISSION_CODES=*` (allow all) atau comma-separated list.
- Bootstrap validation `validateConfig()`:
  - `NODE_ENV=production` + `AUTH_MODE=mock` → throw.
  - `NODE_ENV=production` + `AUTH_MODE=disabled` → throw.
  - `NODE_ENV=production` + `SESSION_STORE=memory` → throw.
  - `SESSION_STORE=redis` + no `REDIS_URL` → throw.
- Unit test:
  - `session.guard.disabled.spec.ts` — `AUTH_MODE=disabled` → skip guard, set fake user dari env.
  - `menu-access.guard.disabled.spec.ts` — `AUTH_MODE=disabled` → skip guard, all endpoints allowed.
  - `payments.controller.menu.spec.ts` — verify `@RequireMenu` decorator metadata di setiap method.

**Out of scope**:
- Endpoint baru `/admin/users`, `/admin/roles` — di luar Plan2 (future).
- User impersonation (admin login as user) — di luar scope.
- `cached_users` sync untuk `AUTH_MODE=disabled` (tidak perlu sync kalau guard skip).
- Encryption `access_token` at rest → opsional, di AUTH-12.
- Audit log untuk denied access → AUTH-19 (observability — metrics `menu_access_denied_total`).

## Files to create/modify

- `apps/payment-api/src/payments/payments.controller.ts` — UPDATE: add `@RequireMenu` decorators
- `apps/payment-api/src/admin/gateway-config.controller.ts` — UPDATE: add `@RequireMenu('payment.admin')` (or create if not exists)
- `apps/payment-api/src/health/health.controller.ts` — UPDATE: add `@Public()`
- `apps/payment-api/src/metrics/metrics.controller.ts` — UPDATE: add `@Public()`
- `packages/security/src/guards/session.guard.ts` — UPDATE (full impl dari stub AUTH-13)
- `packages/security/src/guards/menu-access.guard.ts` — UPDATE (full impl dari stub AUTH-13)
- `apps/payment-api/src/main.ts` — UPDATE: call `validateConfig()` before `NestFactory.create`
- `packages/security/test/session.guard.disabled.spec.ts` — NEW
- `packages/security/test/menu-access.guard.disabled.spec.ts` — NEW
- `apps/payment-api/test/payments.controller.menu.spec.ts` — NEW

## Implementation steps

1. **Update `payments.controller.ts`** (Plan1 existing controller):
   ```ts
   import { RequireMenu } from '@retry-failure/security';

   @Controller('payments')
   export class PaymentsController {
     @Post()
     @RequireMenu('payment.write')
     async createPayment(@Body() dto: CreatePaymentDto, @CurrentUser() user: AuthUser) {
       // Set user_id pada payment (plan2 section 7.3)
       return this.paymentsService.create({ ...dto, userId: user.userId });
     }

     @Get()
     @RequireMenu('payment.read')
     async listPayments(@Query() query: ListPaymentsQuery, @CurrentUser() user: AuthUser) {
       // Bila !isSuperAdmin → filter by user_id
       if (!user.isSuperAdmin) {
         return this.paymentsService.findByUserId(user.userId, query);
       }
       return this.paymentsService.findAll(query);
     }

     @Get(':id')
     @RequireMenu('payment.read')
     async getPayment(@Param('id') id: string, @CurrentUser() user: AuthUser) {
       const payment = await this.paymentsService.findById(id);
       if (!payment) throw new NotFoundException();
       if (!user.isSuperAdmin && payment.userId !== user.userId) {
         throw new NotFoundException(); // hide existence — 404 not 403
       }
       return payment;
     }

     @Post(':id/retry')
     @RequireMenu('payment.retry')
     async retryPayment(@Param('id') id: string, @CurrentUser() user: AuthUser) {
       const payment = await this.paymentsService.findById(id);
       if (!payment) throw new NotFoundException();
       if (!user.isSuperAdmin && payment.userId !== user.userId) {
         throw new NotFoundException();
       }
       return this.paymentsService.retry(id);
     }
   }
   ```

2. **Update `gateway-config.controller.ts`** (admin):
   ```ts
   @Controller('admin/gateway-config')
   export class GatewayConfigController {
     @Get()
     @RequireMenu('payment.admin')
     async getGatewayConfig() {
       return this.configService.get();
     }
   }
   ```

3. **Update `health.controller.ts` + `metrics.controller.ts`**:
   ```ts
   @Controller('health')
   export class HealthController {
     @Get()
     @Public()
     async check() { return { status: 'ok', timestamp: Date.now() }; }
   }

   @Controller('metrics')
   export class MetricsController {
     @Get()
     @Public()
     async metrics() { return this.prometheusService.serialize(); }
   }
   ```

4. **Update `session.guard.ts`** (full impl dari stub AUTH-13):
   ```ts
   @Injectable()
   export class SessionGuard implements CanActivate {
     private readonly logger = new Logger('SessionGuard');

     constructor(
       private readonly reflector: Reflector,
       @Inject('SECURITY_OPTIONS') private readonly options: SecurityOptions,
       @Inject(SESSION_STORE) private readonly sessionStore: SessionStore,
     ) {}

     async canActivate(context: ExecutionContext): Promise<boolean> {
       const req = context.switchToHttp().getRequest();
       const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
         context.getHandler(),
         context.getClass(),
       ]);

       // AUTH_MODE=disabled → set fake user, skip session lookup
       if (this.options.authMode === 'disabled') {
         req.user = this.buildDisabledUser();
         return true;
       }

       // @Public() → skip guard
       if (isPublic) return true;

       // Read cookie sid → session
       const sid = req.cookies?.[this.options.session.cookieName] ?? this.readCookie(req, 'sid');
       if (!sid) {
         throw new UnauthorizedException('Session cookie required');
       }

       const session = await this.sessionStore.get(sid);
       if (!session) {
         throw new UnauthorizedException('Session expired or invalid');
       }

       req.user = {
         userId: session.userId,
         username: session.username,
         roleId: session.roleId,
         isSuperAdmin: false, // lookup from cached_users via middleware (lazy-sync updates session)
         permissionCodes: session.permissionCodes,
       };

       return true;
     }

     private buildDisabledUser(): AuthUser {
       const codes = this.options.disabled.permissionCodes;
       return {
         userId: this.options.disabled.userId,
         username: this.options.disabled.username,
         roleId: this.options.disabled.roleId,
         isSuperAdmin: this.options.disabled.isSuperAdmin,
         permissionCodes: codes === '*' ? ['*'] : codes.split(',').map(s => s.trim()),
       };
     }

     private readCookie(req: any, name: string): string | undefined {
       const raw = req.headers.cookie;
       if (!raw) return undefined;
       for (const part of raw.split(';')) {
         const [k, v] = part.trim().split('=');
         if (k === name) return v;
       }
       return undefined;
     }
   }
   ```

5. **Update `menu-access.guard.ts`** (full impl dari stub AUTH-13):
   ```ts
   @Injectable()
   export class MenuAccessGuard implements CanActivate {
     private readonly logger = new Logger('MenuAccessGuard');

     constructor(
       private readonly reflector: Reflector,
       @Inject('SECURITY_OPTIONS') private readonly options: SecurityOptions,
     ) {}

     canActivate(context: ExecutionContext): boolean {
       const req = context.switchToHttp().getRequest();
       const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
         context.getHandler(),
         context.getClass(),
       ]);
       if (isPublic) return true;

       // AUTH_MODE=disabled → skip (semua endpoint allowed)
       if (this.options.authMode === 'disabled') return true;

       const user = req.user as AuthUser | undefined;
       if (!user) return true; // SessionGuard should have set user; if not, it's @Public or disabled

       // Super admin bypass
       if (user.isSuperAdmin) return true;

       // permissionCodes = '*' (wildcard from disabled mode fallback)
       if (user.permissionCodes.includes('*')) return true;

       // Read @RequireMenu metadata
       const requiredMenus = this.reflector.getAllAndOverride<string[]>(REQUIRE_MENU_KEY, [
         context.getHandler(),
         context.getClass(),
       ]);
       if (!requiredMenus || requiredMenus.length === 0) return true; // no menu required

       // OR logic — user cukup punya salah satu
       const hasAny = requiredMenus.some(code => user.permissionCodes.includes(code));
       if (!hasAny) {
         this.logger.warn(`Access denied menu=${requiredMenus.join(',')} user=${user.username} permissions=${user.permissionCodes.join(',')}`);
         throw new ForbiddenException(`Missing required menu: ${requiredMenus.join(' or ')}`);
       }

       return true;
     }
   }
   ```

6. **Register guards di `app.module.ts`** (UPDATE dari AUTH-17):
   ```ts
   @Module({
     providers: [
       // Order: ThrottlerGuard first, then SessionGuard, then MenuAccessGuard
       { provide: APP_GUARD, useClass: ThrottlerGuard },
       { provide: APP_GUARD, useClass: SessionGuard },
       { provide: APP_GUARD, useClass: MenuAccessGuard },
     ],
   })
   export class AppModule {}
   ```

7. **Bootstrap validation di `main.ts`** (UPDATE dari AUTH-17, finalize):
   ```ts
   function validateConfig() {
     const { NODE_ENV, AUTH_MODE, SESSION_STORE } = process.env;

     if (NODE_ENV === 'production') {
       if (AUTH_MODE === 'mock')     throw new Error('AUTH_MODE=mock tidak boleh di production');
       if (AUTH_MODE === 'disabled') throw new Error('AUTH_MODE=disabled tidak boleh di production');
       if (SESSION_STORE === 'memory') throw new Error('SESSION_STORE=memory tidak boleh di production');
     }

     if (SESSION_STORE === 'redis' && !process.env.REDIS_URL) {
       throw new Error('REDIS_URL wajib diisi kalau SESSION_STORE=redis');
     }

     if (AUTH_MODE === 'disabled') {
       if (!process.env.AUTH_DISABLED_USER_ID) throw new Error('AUTH_DISABLED_USER_ID wajib kalau AUTH_MODE=disabled');
       if (!process.env.AUTH_DISABLED_USERNAME) throw new Error('AUTH_DISABLED_USERNAME wajib kalau AUTH_MODE=disabled');
       if (!process.env.AUTH_DISABLED_ROLE_ID) throw new Error('AUTH_DISABLED_ROLE_ID wajib kalau AUTH_MODE=disabled');
     }
   }
   ```

8. **Unit test `session.guard.disabled.spec.ts`**:
   - Test cases:
     - `AUTH_MODE=disabled` + `IS_PUBLIC_KEY=false` → `req.user` set dari env, return true.
     - `AUTH_MODE=disabled` + `IS_PUBLIC_KEY=true` → `req.user` set dari env (still), return true.
     - `AUTH_MODE=oauth` + no cookie sid → throw `UnauthorizedException`.
     - `AUTH_MODE=oauth` + cookie sid + session not found → throw `UnauthorizedException`.
     - `AUTH_MODE=oauth` + cookie sid + session found → `req.user` set, return true.
     - `AUTH_MODE=oauth` + `IS_PUBLIC_KEY=true` + no cookie → return true (no user set).
     - Verify `buildDisabledUser()` parse `AUTH_DISABLED_PERMISSION_CODES='*'` → `['*']`.
     - Verify `buildDisabledUser()` parse `'payment.read,payment.write'` → `['payment.read', 'payment.write']`.

9. **Unit test `menu-access.guard.disabled.spec.ts`**:
   - Test cases:
     - `AUTH_MODE=disabled` → return true tanpa check (semua endpoint allowed).
     - `@Public()` → return true.
     - `isSuperAdmin=true` → return true (bypass).
     - `@RequireMenu('payment.write')` + `permissionCodes=['payment.write']` → return true.
     - `@RequireMenu('payment.write', 'payment.admin')` + `permissionCodes=['payment.read']` → throw `ForbiddenException`.
     - `@RequireMenu('payment.write', 'payment.admin')` + `permissionCodes=['payment.admin']` → return true (OR logic).
     - `permissionCodes=['*']` → return true (wildcard).
     - No `@RequireMenu` decorator → return true (no menu required).

10. **Unit test `payments.controller.menu.spec.ts`**:
    - Test cases:
      - Verify `@RequireMenu('payment.write')` metadata di `createPayment` method.
      - Verify `@RequireMenu('payment.read')` di `listPayments` + `getPayment`.
      - Verify `@RequireMenu('payment.retry')` di `retryPayment`.
      - Verify `@Public()` di `health.controller.check`.
      - Verify `@Public()` di `metrics.controller.metrics`.

## Acceptance criteria

- [ ] `PaymentsController` punya `@RequireMenu` di 4 method: `createPayment` (`payment.write`), `listPayments` (`payment.read`), `getPayment` (`payment.read`), `retryPayment` (`payment.retry`) per plan2 section 6.2.
- [ ] `GatewayConfigController.getGatewayConfig` punya `@RequireMenu('payment.admin')`.
- [ ] `HealthController.check` punya `@Public()`.
- [ ] `MetricsController.metrics` punya `@Public()`.
- [ ] `SessionGuard` handle `AUTH_MODE=disabled`: skip guard, set `req.user` dari env (`AUTH_DISABLED_*`).
- [ ] `MenuAccessGuard` handle `AUTH_MODE=disabled`: skip guard, semua endpoint allowed.
- [ ] `MenuAccessGuard` OR logic: `@RequireMenu('a', 'b')` → user cukup punya salah satu.
- [ ] `MenuAccessGuard` super admin bypass: `isSuperAdmin=true` → skip menu check.
- [ ] `MenuAccessGuard` wildcard: `permissionCodes=['*']` → allow all.
- [ ] `MenuAccessGuard` denied: throw `ForbiddenException` dengan message `Missing required menu: ...`.
- [ ] `SessionGuard` `@Public()` skip: tidak throw bila endpoint `@Public()` + no cookie.
- [ ] `SessionGuard` no cookie + non-public → throw `UnauthorizedException`.
- [ ] Bootstrap validation `validateConfig()`:
  - `NODE_ENV=production` + `AUTH_MODE=mock` → throw.
  - `NODE_ENV=production` + `AUTH_MODE=disabled` → throw.
  - `NODE_ENV=production` + `SESSION_STORE=memory` → throw.
  - `SESSION_STORE=redis` + no `REDIS_URL` → throw.
  - `AUTH_MODE=disabled` + no `AUTH_DISABLED_USER_ID` → throw.
- [ ] Guards registered sebagai `APP_GUARD` di `app.module.ts` (Throttler → Session → MenuAccess order).
- [ ] `createPayment` set `userId` dari `@CurrentUser()` ke payment record (per plan2 section 7.3).
- [ ] `listPayments` filter by `userId` bila `!isSuperAdmin`.
- [ ] `getPayment` + `retryPayment` hide existence (404 bukan 403) bila `!isSuperAdmin && payment.userId !== user.userId`.
- [ ] Unit test `session.guard.disabled.spec.ts` + `menu-access.guard.disabled.spec.ts` + `payments.controller.menu.spec.ts` lulus.
- [ ] `pnpm --filter @retry-failure/security typecheck` + `lint` lulus.
- [ ] `pnpm --filter payment-api typecheck` + `lint` lulus.

## Useful commands

```bash
# Typecheck
cd  && pnpm --filter @retry-failure/security typecheck
cd  && pnpm --filter payment-api typecheck

# Lint
cd  && pnpm --filter @retry-failure/security lint
cd  && pnpm --filter payment-api lint

# Run guard tests
cd  && pnpm --filter @retry-failure/security test -- --testPathPattern="(session.guard|menu-access.guard)"

# Run payment-api controller test
cd  && pnpm --filter payment-api test -- --testPathPattern="payments.controller.menu"

# Manual verify @RequireMenu metadata via TypeScript reflection
node -e "
const { Reflector } = require('@nestjs/core');
const reflector = new Reflector();
// Load controller class + check decorator metadata
"

# Manual test flow (after AUTH-17 done, with auth-mock running):
# 1. Login as budi_santoso (HRD role) — permissionCodes = ['dashboard', 'payment.read', 'payment.write']
# 2. POST /payments → 200 OK (have payment.write)
# 3. POST /payments/:id/retry → 403 (no payment.retry)
# 4. Switch role to Finance — permissionCodes = ['dashboard', 'payment.read', 'payment.retry']
# 5. POST /payments → 403 (no payment.write)
# 6. POST /payments/:id/retry → 200 (have payment.retry)

# Login as superadmin (isSuperAdmin=true) → all endpoints allowed
# 1. POST /payments → 200
# 2. POST /payments/:id/retry → 200
# 3. GET /admin/gateway-config → 200

# Test AUTH_MODE=disabled
AUTH_MODE=disabled AUTH_DISABLED_USER_ID=00000000-0000-0000-0000-000000000001 \
  AUTH_DISABLED_USERNAME=disabled-user AUTH_DISABLED_ROLE_ID=00000000-0000-0000-0000-000000000002 \
  SESSION_STORE=memory SESSION_SECRET=$(openssl rand -hex 32) \
  pnpm --filter payment-api start:dev &

# Without cookie:
curl -s http://localhost:3001/payments
# Expect: 200 (all allowed, user = disabled-user)

curl -s http://localhost:3001/admin/gateway-config
# Expect: 200 (super admin bypass)

# Test bootstrap validation
NODE_ENV=production AUTH_MODE=mock SESSION_STORE=redis pnpm --filter payment-api start:dev
# Expect: throw "AUTH_MODE=mock tidak boleh di production"
```

## Notes

- **Mapping endpoint → menu** (plan2 section 6.2):
  - `POST /payments` → `payment.write`.
  - `GET /payments` → `payment.read`.
  - `GET /payments/:id` → `payment.read`.
  - `POST /payments/:id/retry` → `payment.retry`.
  - `GET /admin/gateway-config` → `payment.admin`.
  - `GET /health`, `GET /metrics`, `GET /docs`, `/auth/*` → public.
- **Super admin bypass** (plan2 section 6.3): `is_super_admin=true` dari `cached_users`. Bypass di `MenuAccessGuard` — semua menu code allowed.
- **`AUTH_MODE=disabled` behavior** (plan2 section 9.3.1):
  - `SessionGuard` skip → set `req.user` dari env.
  - `MenuAccessGuard` skip → semua endpoint allowed.
  - `LazySyncMiddleware` skip (di AUTH-14).
  - `@Public()` diabaikan (semua sudah publik).
  - `@RequireMenu()` diabaikan.
  - `/auth/login`, `/auth/callback` → 501 (di AUTH-17).
  - `/auth/session` → return user palsu (di AUTH-17).
  - `/auth/logout` → 200 OK no-op (di AUTH-17).
- **Guard production** (plan2 section 9.3.2):
  - `NODE_ENV=production` + `AUTH_MODE=mock` → throw.
  - `NODE_ENV=production` + `AUTH_MODE=disabled` → throw.
  - `NODE_ENV=production` + `SESSION_STORE=memory` → throw.
- **Hide existence** (404 vs 403): bila user tidak punya akses ke payment tertentu (`payment.userId !== user.userId`), return `404` bukan `403`. Cegah information leak (user tahu payment ID ada tapi tidak punya akses).
- **Order of guards**: NestJS run `APP_GUARD` providers in order. Pastikan:
  1. `ThrottlerGuard` (rate limit, no auth needed).
  2. `SessionGuard` (set `req.user` from cookie).
  3. `MenuAccessGuard` (check `req.user.permissionCodes` vs `@RequireMenu`).
- **`@CurrentUser()` decorator** (dari AUTH-13) inject `req.user` ke method parameter. Sudah ada — pakai di controller method.
- **`@Public()` decorator** (dari AUTH-13) menandai endpoint tidak butuh session. Guard check via `Reflector.getAllAndOverride(IS_PUBLIC_KEY, ...)`.
- **`@RequireMenu()` decorator** (dari AUTH-13) menandai endpoint butuh menu code. `Reflector.getAllAndOverride(REQUIRE_MENU_KEY, ...)`.
- Setelah task ini selesai, **Plan 2 Fase 1 langkah 5** (integrate guard + middleware) tercapai sepenuhnya. Selanjutnya: AUTH-19 (observability), AUTH-20 (FE Vue axios), dll.
