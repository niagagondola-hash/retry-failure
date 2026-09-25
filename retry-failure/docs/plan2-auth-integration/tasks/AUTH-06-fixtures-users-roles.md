# AUTH-06 — auth-mock fixture users + roles + permissions

> **Task ID**: AUTH-06
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-03 (UserService interface)
> **Estimated effort**: S (~60 min)
> **Plan reference**: Section 10.4 (fixture user), Section 6.1 (menu codes), Section 5.2 (JWT payload), Section 10.6 (response /api/v1/me/permissions), AUTH_CONTRACT.md section 4 + 6

---

## Goal

Mengisi `UserService` di auth-mock dengan fixture users + roles + permissions lengkap sesuai plan2 section 10.4. Dua user utama: `superadmin` (single role, `isSuperAdmin=true`) dan `budi_santoso` (multi-role: HRD + Finance). Password dev: `ChangeMe_123!`. Permission codes mengikuti plan2 section 6.1 (5 menu codes).

## Scope

**In scope**:
- 2 fixture users:
  - `superadmin` (UUID stabil, single role `Super Admin`, `isSuperAdmin=true`, `permissionCodes: ["*"]` atau semua 5 codes).
  - `budi_santoso` (UUID stabil, multi-role: HRD + Finance, `isSuperAdmin=false`).
- 2 roles dengan permission codes berbeda:
  - `Super Admin` — semua permission (`*` atau list lengkap).
  - `HRD` — subset: `dashboard`, `payment.read`.
  - `Finance` — subset: `dashboard`, `payment.read`, `payment.write`, `payment.retry`.
- 5 menu codes (plan2 section 6.1):
  - `dashboard`, `payment.read`, `payment.write`, `payment.retry`, `payment.admin`.
- UUID stabil (hardcoded) supaya test + dev consistent lintas restart.
- Password dev: `ChangeMe_123!` (plain string comparison; auth-mock = dev only).
- Seed method di `UserService` (`seedFixtures()`) dipanggil di `OnModuleInit`.
- Update `UserService` stub dari AUTH-03/AUTH-05 dengan data lengkap + method `findByUsername`.
- File: `apps/auth-mock/src/modules/user/fixtures.ts` — data fixtures (konstanta `FIXTURE_USERS`).
- Unit test yang verify fixtures shape + login + role switch.

**Out of scope**:
- Hashing password (bcrypt/argon2) — auth-mock dev only, plain comparison acceptable. **Catat di TODO** untuk production.
- Database persistence — fixtures in-memory, hilang saat restart (acceptable untuk mock).
- Admin panel UI untuk CRUD users/roles → tidak ada di auth-mock (plan2 section 25 — admin panel di auth asli).
- Dynamic roles / menus dari DB → tidak, hardcoded.
- Refresh rotation store integration → sudah di AUTH-03.

## Files to create/modify

- `apps/auth-mock/src/modules/user/fixtures.ts` — konstanta `FIXTURE_USERS`, `FIXTURE_ROLES`, `FIXTURE_MENUS`
- `apps/auth-mock/src/modules/user/user.service.ts` — implementasi lengkap dengan `OnModuleInit` seed + `findByUsername`
- `apps/auth-mock/src/modules/user/user.types.ts` (opsional, kalau types perlu di-extract)
- `apps/auth-mock/src/modules/user/user.module.ts` — verify export
- `apps/auth-mock/test/user.service.spec.ts` — verify fixtures + login + role lookup

## Implementation steps

1. **Buat `fixtures.ts`** dengan UUID stabil (pakai UUID v4 yang fixed, bukan random):
   ```ts
   // apps/auth-mock/src/modules/user/fixtures.ts
   import { MockUser } from './user.service';

   // UUID stabil supaya test consistent lintas restart
   export const FIXTURE_USER_IDS = {
     superadmin: '00000000-0000-1000-8000-000000000001',
     budi:       '00000000-0000-1000-8000-000000000002',
   } as const;

   export const FIXTURE_ROLE_IDS = {
     superAdmin: '00000000-0000-1000-8000-000000000101',
     hrd:        '00000000-0000-1000-8000-000000000102',
     finance:    '00000000-0000-1000-8000-000000000103',
   } as const;

   export const FIXTURE_MENU_CODES = [
     'dashboard',
     'payment.read',
     'payment.write',
     'payment.retry',
     'payment.admin',
   ] as const;

   export const ALL_PERMISSION_CODES = [...FIXTURE_MENU_CODES];

   export const FIXTURE_USERS: MockUser[] = [
     {
       id: FIXTURE_USER_IDS.superadmin,
       username: 'superadmin',
       passwordHash: 'ChangeMe_123!',
       email: 'superadmin@mock.local',
       name: 'Super Admin',
       isSuperAdmin: true,
       roles: [
         {
           id: FIXTURE_ROLE_IDS.superAdmin,
           name: 'Super Admin',
           description: 'Full access (bypass all menu checks)',
           permissionCodes: ALL_PERMISSION_CODES,
         },
       ],
     },
     {
       id: FIXTURE_USER_IDS.budi,
       username: 'budi_santoso',
       passwordHash: 'ChangeMe_123!',
       email: 'budi@perusahaan.com',
       name: 'Budi Santoso',
       isSuperAdmin: false,
       roles: [
         {
           id: FIXTURE_ROLE_IDS.hrd,
           name: 'HRD',
           description: 'Human Resources — view payments only',
           permissionCodes: ['dashboard', 'payment.read'],
         },
         {
           id: FIXTURE_ROLE_IDS.finance,
           name: 'Finance',
           description: 'Finance — view + create + retry payments',
           permissionCodes: ['dashboard', 'payment.read', 'payment.write', 'payment.retry'],
         },
       ],
     },
   ];
   ```

2. **Update `UserService`** dengan `OnModuleInit` + `findByUsername`:
   ```ts
   import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
   import { FIXTURE_USERS } from './fixtures';

   export interface Role {
     id: string;
     name: string;
     description?: string;
     permissionCodes: string[];
   }

   export interface MockUser {
     id: string;
     username: string;
     passwordHash: string; // DEV ONLY — plain text, NEVER production
     email?: string;
     name: string;
     isSuperAdmin: boolean;
     roles: Role[];
   }

   @Injectable()
   export class UserService implements OnModuleInit {
     private readonly logger = new Logger('UserService');
     private readonly users = new Map<string, MockUser>();

     async onModuleInit() {
       for (const u of FIXTURE_USERS) {
         this.users.set(u.id, u);
       }
       this.logger.log(`Seeded ${this.users.size} fixture users`);
     }

     async validateCredentials(username: string, password: string): Promise<MockUser | null> {
       const user = await this.findByUsername(username);
       if (!user) return null;
       // DEV ONLY: plain text comparison. Production: bcrypt.compare(password, user.passwordHash).
       if (user.passwordHash !== password) return null;
       return user;
     }

     async findById(id: string): Promise<MockUser | null> {
       return this.users.get(id) ?? null;
     }

     async findByUsername(username: string): Promise<MockUser | null> {
       for (const u of this.users.values()) {
         if (u.username === username) return u;
       }
       return null;
     }

     async findRole(user: MockUser, roleId: string): Promise<Role | undefined> {
       return user.roles.find((r) => r.id === roleId);
     }
   }
   ```

3. **Verify `UserModule`** export `UserService`:
   ```ts
   @Module({
     providers: [UserService],
     exports: [UserService],
   })
   export class UserModule {}
   ```

4. **Verify integration dengan AUTH-03/05**:
   - `OAuthController.submitLogin` pakai `validateCredentials` → harus return `budi_santoso` atau `superadmin`.
   - `OAuthController.renderRoleOrRedirect` pakai `user.roles` array → multi-role render select-role.
   - `InternalService.getPermissions` pakai `findById` + `role.permissionCodes`.
   - `DevController.devToken` pakai `findByUsername` + `user.roles[0]` (atau `roleId` dari body).

5. **Unit test** (`apps/auth-mock/test/user.service.spec.ts`):
   ```ts
   describe('UserService', () => {
     let svc: UserService;
     beforeEach(async () => {
       const mod = await Test.createTestingModule({ providers: [UserService] }).compile();
       svc = mod.get(UserService);
       await svc.onModuleInit();
     });

     it('seeds 2 fixture users', () => {
       // verify users Map punya 2 entries
     });

     it('validates budi_santoso + ChangeMe_123!', async () => {
       const u = await svc.validateCredentials('budi_santoso', 'ChangeMe_123!');
       expect(u).toBeDefined();
       expect(u!.username).toBe('budi_santoso');
     });

     it('rejects wrong password', async () => {
       const u = await svc.validateCredentials('budi_santoso', 'wrong');
       expect(u).toBeNull();
     });

     it('rejects unknown user', async () => {
       const u = await svc.validateCredentials('hacker', 'ChangeMe_123!');
       expect(u).toBeNull();
     });

     it('superadmin has single role', async () => {
       const u = await svc.findByUsername('superadmin');
       expect(u!.roles).toHaveLength(1);
       expect(u!.roles[0].name).toBe('Super Admin');
       expect(u!.isSuperAdmin).toBe(true);
     });

     it('budi has 2 roles: HRD + Finance', async () => {
       const u = await svc.findByUsername('budi_santoso');
       expect(u!.roles).toHaveLength(2);
       const names = u!.roles.map(r => r.name);
       expect(names).toEqual(expect.arrayContaining(['HRD', 'Finance']));
     });

     it('HRD role has dashboard + payment.read', async () => {
       const u = await svc.findByUsername('budi_santoso');
       const hrd = u!.roles.find(r => r.name === 'HRD')!;
       expect(hrd.permissionCodes).toEqual(expect.arrayContaining(['dashboard', 'payment.read']));
       expect(hrd.permissionCodes).not.toContain('payment.write');
     });

     it('Finance role has dashboard + read + write + retry', async () => {
       const u = await svc.findByUsername('budi_santoso');
       const fin = u!.roles.find(r => r.name === 'Finance')!;
       expect(fin.permissionCodes).toEqual(
         expect.arrayContaining(['dashboard', 'payment.read', 'payment.write', 'payment.retry']),
       );
       expect(fin.permissionCodes).not.toContain('payment.admin');
     });

     it('Super Admin has all 5 codes', async () => {
       const u = await svc.findByUsername('superadmin');
       expect(u!.roles[0].permissionCodes).toHaveLength(5);
     });

     it('findRole returns role or undefined', async () => {
       const u = await svc.findByUsername('budi_santoso')!;
       const hrd = await svc.findRole(u!, '00000000-0000-1000-8000-000000000102');
       expect(hrd).toBeDefined();
       expect(hrd!.name).toBe('HRD');

       const notFound = await svc.findRole(u!, 'invalid-role-id');
       expect(notFound).toBeUndefined();
     });
   });
   ```

6. **Manual verify** end-to-end:
   - Start auth-mock.
   - Login via UI dengan `budi_santoso` / `ChangeMe_123!` → select-role page muncul.
   - Login dengan `superadmin` / `ChangeMe_123!` → langsung redirect dengan code (single-role).
   - Dev token via `POST /dev/token` → verify `roleId` pertama (HRD untuk budi).
   - Switch role → verify permissionCodes berubah.

## Acceptance criteria

- [ ] `UserService.onModuleInit()` seed 2 fixture users.
- [ ] `superadmin` punya:
  - 1 role (`Super Admin`),
  - `isSuperAdmin: true`,
  - `permissionCodes` berisi semua 5 menu codes.
- [ ] `budi_santoso` punya:
  - 2 roles (`HRD`, `Finance`),
  - `isSuperAdmin: false`,
  - HRD: `['dashboard', 'payment.read']`,
  - Finance: `['dashboard', 'payment.read', 'payment.write', 'payment.retry']`.
- [ ] Password dev `ChangeMe_123!` berfungsi untuk kedua user.
- [ ] Login flow AUTH-03 berfungsi end-to-end dengan fixture ini.
- [ ] `GET /api/v1/me/permissions` (AUTH-05) return data sesuai plan2 section 10.6 untuk `budi_santoso` (role HRD).
- [ ] Switch role `budi_santoso` dari HRD → Finance → permissionCodes berubah dari 2 codes → 4 codes.
- [ ] `/dev/token` body `{ "username": "budi_santoso" }` (tanpa roleId) → return token dengan roleId HRD (role pertama).
- [ ] `/dev/token` body `{ "username": "budi_santoso", "roleId": "<finance-id>" }` → return token dengan roleId Finance.
- [ ] UUID stabil lintas restart (test bisa hardcode UUID).
- [ ] `pnpm --filter auth-mock test` lulus (semua spec).
- [ ] `pnpm --filter auth-mock typecheck` + `lint` lulus.

## Useful commands

```bash
# Start auth-mock
cd /apps/auth-mock && pnpm start:dev

# Get dev token for budi
curl -s -X POST http://localhost:4001/dev/token \
  -H "Content-Type: application/json" \
  -d '{"username":"budi_santoso"}' | jq .

# Get dev token for budi as Finance role
curl -s -X POST http://localhost:4001/dev/token \
  -H "Content-Type: application/json" \
  -d '{"username":"budi_santoso","roleId":"00000000-0000-1000-8000-000000000103"}' | jq .

# Verify /me/permissions for budi (HRD)
TOKEN="<access_token>"
curl -s http://localhost:4001/api/v1/me/permissions -H "Authorization: Bearer $TOKEN" | jq .
# Expected: role.name = "HRD", permissionCodes = ["dashboard","payment.read"]

# Switch role to Finance
curl -s -X POST http://localhost:4001/api/v1/auth/switch-role \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"roleId":"00000000-0000-1000-8000-000000000103"}' | jq .

# Verify permissionCodes changed to 4 codes
NEW_TOKEN="<new_access_token>"
curl -s http://localhost:4001/api/v1/me/permissions -H "Authorization: Bearer $NEW_TOKEN" | jq '.data.role, .data.permissionCodes'

# Test superadmin (single role — should NOT show select-role page)
# 1. Open browser to: http://localhost:4001/oauth/authorize?response_type=code&client_id=payment-api&redirect_uri=http://localhost:3001/auth/callback&state=abc&code_challenge=<challenge>&code_challenge_method=S256
# 2. Login superadmin/ChangeMe_123!
# 3. Expected: directly redirect to redirect_uri?code=...&state=abc (no select-role page)

# Test budi (multi-role — should show select-role page)
# 1. Same authorize URL
# 2. Login budi_santoso/ChangeMe_123!
# 3. Expected: select-role page with HRD + Finance radio buttons

# Run tests
cd  && pnpm --filter auth-mock test

# Run only user.service spec
cd /apps/auth-mock && pnpm test user.service.spec.ts

# Typecheck + lint
cd  && pnpm --filter auth-mock typecheck
cd  && pnpm --filter auth-mock lint
```

## Notes

- **Plain text password** acceptable untuk dev mock. Production WAJIB bcrypt/argon2. Catat di TODO atau di `apps/auth-mock/README.md` dengan warning jelas.
- **UUID stabil** penting untuk testing — payment-api contract test bisa hardcode user IDs untuk assert response shape.
- **HRD role** (`['dashboard', 'payment.read']`) — view-only, tidak bisa create/retry payment. Cocok untuk test 403 (MenuAccessGuard) di payment-api.
- **Finance role** (`['dashboard', 'payment.read', 'payment.write', 'payment.retry']`) — bisa create + retry, tapi tidak bisa admin gateway config.
- **Super Admin role** — semua 5 codes. Tapi karena `isSuperAdmin: true`, `MenuAccessGuard` akan bypass cek permission. Permission codes lebih untuk dokumentasi.
- **Menu codes** mengikuti plan2 section 6.1:
  - `dashboard` — Dashboard view
  - `payment.read` — Lihat Payment
  - `payment.write` — Buat Payment
  - `payment.retry` — Retry Payment
  - `payment.admin` — Admin Payment (gateway config)
- **`passwordHash` field** misnamed (sebenarnya plain password). Dev convention. Bila ingin lebih jujur, rename ke `passwordPlain` — tapi breaks backward compat dengan AUTH-03 stub. Tahan dan catat TODO.
- Setelah task ini selesai, AUTH-07 (OIDC discovery) bisa mulai — semua endpoint sudah ada, tinggal compose discovery document.
