# AUTH-05 — auth-mock internal endpoints (permissions + switch-role + dev/token)

> **Task ID**: AUTH-05
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-03
> **Estimated effort**: M (~90 min)
> **Plan reference**: Section 10.1 (scope), Section 10.6 (response /api/v1/me/permissions), Section 5.6 (ganti active role flow), Section 25.3.G (internal endpoints), Section 9.1 (OAUTH_PATHS.permissions + switchRole), AUTH_CONTRACT.md section 3 + 6

---

## Goal

Implementasi 3 endpoint internal yang dipanggil BE payment-api (BFF) ke auth-mock: `GET /api/v1/me/permissions` (data otorisasi untuk lazy sync), `POST /api/v1/auth/switch-role` (ganti active role + issue JWT baru), dan `POST /dev/token` (dev shortcut untuk dapat token tanpa OAuth flow — dipakai untuk testing/debug payment-api).

## Scope

**In scope**:
- `GET /api/v1/me/permissions`:
  - Auth: `Authorization: Bearer <access_token>`.
  - Verify token via `JwtSignerService.verify()`.
  - Response per plan2 section 10.6 / AUTH_CONTRACT section 6: `{ success, data: { user, role, permissionCodes } }`.
- `POST /api/v1/auth/switch-role`:
  - Auth: `Authorization: Bearer <access_token>`.
  - Body: `{ roleId: string }`.
  - Validasi `roleId` milik user (via `UserService.findById` + cek `user.roles`).
  - Issue JWT baru dengan `roleId` baru.
  - Return: `{ success, data: { accessToken, refreshToken, role } }`.
- `POST /dev/token`:
  - **Dev only**: reject bila `NODE_ENV=production` (fail fast).
  - Body: `{ username, roleId? }` (roleId opsional — kalau user multi-role dan tidak diisi, pilih role pertama).
  - Skip OAuth flow, langsung issue access + refresh token.
  - Return: `{ accessToken, refreshToken, role, user }`.
- `InternalController` + `InternalService` + `DevController`.
- Bearer token middleware/guard (verify via `JwtSignerService`).
- Wire module: import `KeyPairModule`, `UserModule`.

**Out of scope**:
- Fixture users/roles/permissions data → AUTH-06 (task ini pakai interface `UserService`, isi data di AUTH-06).
- Token revocation webhook → tidak ada (plan2 section 8.5 webhook opsional, skip untuk mock).
- Rate limiting internal endpoints → tidak (rate limit di BE payment sisi).
- OpenAPI spec → akan dibuat terpisah (plan2 section 18.6 menyebut `auth-openapi.json`).

## Files to create/modify

- `apps/auth-mock/src/modules/internal/internal.module.ts`
- `apps/auth-mock/src/modules/internal/internal.controller.ts` — `GET /api/v1/me/permissions` + `POST /api/v1/auth/switch-role`
- `apps/auth-mock/src/modules/internal/internal.service.ts` — business logic (verify token, fetch user, build permissions response, switch role)
- `apps/auth-mock/src/modules/internal/dev.controller.ts` — `POST /dev/token`
- `apps/auth-mock/src/modules/internal/dto/switch-role.dto.ts`
- `apps/auth-mock/src/modules/internal/dto/dev-token.dto.ts`
- `apps/auth-mock/src/modules/internal/bearer-auth.guard.ts` — verify Bearer token via `JwtSignerService`
- `apps/auth-mock/src/modules/internal/bearer-auth.decorator.ts` — `@BearerAuth()` (opsional, kalau pakai guard per-route)
- `apps/auth-mock/src/modules/user/user.service.ts` — extend dengan `findRoleById(user, roleId)` + `listPermissionCodes(userId, roleId)` (stub; isi fixtures di AUTH-06)
- `apps/auth-mock/src/app.module.ts` — import `InternalModule`
- `apps/auth-mock/test/internal.controller.spec.ts`
- `apps/auth-mock/test/dev.controller.spec.ts`
- `apps/auth-mock/test/e2e/internal-flow.e2e-spec.ts`

## Implementation steps

1. **`BearerAuthGuard`** (`apps/auth-mock/src/modules/internal/bearer-auth.guard.ts`):
   ```ts
   import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
   import { JwtSignerService } from '../keypair/jwt-signer.service';
   import { Reflector } from '@nestjs/core';

   export const IS_PUBLIC_KEY = 'isPublic';

   @Injectable()
   export class BearerAuthGuard implements CanActivate {
     constructor(
       private readonly jwtSigner: JwtSignerService,
       private readonly reflector: Reflector,
     ) {}

     async canActivate(ctx: ExecutionContext): Promise<boolean> {
       const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
         ctx.getHandler(),
         ctx.getClass(),
       ]);
       if (isPublic) return true;

       const req = ctx.switchToHttp().getRequest();
       const auth = req.headers['authorization'] ?? '';
       const match = /^Bearer\s+(.+)$/i.exec(auth);
       if (!match) throw new UnauthorizedException('Missing Bearer token');

       try {
         const payload = await this.jwtSigner.verify(
           match[1],
           process.env.JWT_AUDIENCE ?? 'payment-api',
           process.env.AUTH_ISSUER ?? 'http://localhost:4001',
         );
         req.user = payload; // { sub, username, roleId, ... }
         return true;
       } catch (err) {
         throw new UnauthorizedException('Invalid or expired token');
       }
     }
   }
   ```

2. **`InternalController`** (`apps/auth-mock/src/modules/internal/internal.controller.ts`):
   ```ts
   import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
   import { Request } from 'express';
   import { InternalService } from './internal.service';
   import { BearerAuthGuard } from './bearer-auth.guard';
   import { SwitchRoleDto } from './dto/switch-role.dto';
   import { JWTPayload } from 'jose';

   @Controller('api/v1')
   @UseGuards(BearerAuthGuard)
   export class InternalController {
     constructor(private readonly internal: InternalService) {}

     @Get('me/permissions')
     async mePermissions(@Req() req: Request & { user: JWTPayload }) {
       const data = await this.internal.getPermissions(req.user);
       return { success: true, data };
     }

     @Post('auth/switch-role')
     async switchRole(@Req() req: Request & { user: JWTPayload }, @Body() dto: SwitchRoleDto) {
       const data = await this.internal.switchRole(req.user, dto.roleId);
       return { success: true, data };
     }
   }
   ```

3. **`InternalService`** (`apps/auth-mock/src/modules/internal/internal.service.ts`):
   ```ts
   import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
   import { UserService, MockUser, Role } from '../user/user.service';
   import { JwtSignerService } from '../keypair/jwt-signer.service';
   import { JWTPayload } from 'jose';

   @Injectable()
   export class InternalService {
     constructor(
       private readonly users: UserService,
       private readonly jwtSigner: JwtSignerService,
     ) {}

     async getPermissions(jwt: JWTPayload) {
       const user = await this.users.findById(jwt.sub!);
       if (!user) throw new NotFoundException('User not found');
       const role = user.roles.find((r) => r.id === jwt.roleId);
       if (!role) throw new BadRequestException('Active role no longer assigned to user');
       return {
         user: this.toUserDto(user),
         role: { id: role.id, name: role.name },
         permissionCodes: role.permissionCodes,
       };
     }

     async switchRole(jwt: JWTPayload, newRoleId: string) {
       const user = await this.users.findById(jwt.sub!);
       if (!user) throw new NotFoundException('User not found');
       const role = user.roles.find((r) => r.id === newRoleId);
       if (!role) throw new BadRequestException('Role not assigned to this user');

       const issuer = process.env.AUTH_ISSUER ?? 'http://localhost:4001';
       const audience = process.env.JWT_AUDIENCE ?? 'payment-api';
       const accessToken = await this.jwtSigner.sign(
         { sub: user.id, username: user.username, roleId: role.id },
         { issuer, audience, expiresIn: '15m' },
       );
       const refreshToken = await this.jwtSigner.sign(
         { sub: user.id, username: user.username, roleId: role.id, type: 'refresh' },
         { issuer, audience, expiresIn: '8h' },
       );
       return {
         accessToken,
         refreshToken,
         role: { id: role.id, name: role.name },
       };
     }

     private toUserDto(u: MockUser) {
       return {
         id: u.id,
         username: u.username,
         email: u.email,
         name: u.name,
         isSuperAdmin: u.isSuperAdmin,
       };
     }
   }
   ```

4. **`DevController`** (`apps/auth-mock/src/modules/internal/dev.controller.ts`):
   ```ts
   import { Body, Controller, Post, ForbiddenException } from '@nestjs/common';
   import { InternalService } from './internal.service';
   import { UserService } from '../user/user.service';
   import { JwtSignerService } from '../keypair/jwt-signer.service';
   import { DevTokenDto } from './dto/dev-token.dto';

   @Controller('dev')
   export class DevController {
     constructor(
       private readonly users: UserService,
       private readonly jwtSigner: JwtSignerService,
     ) {}

     @Post('token')
     async devToken(@Body() dto: DevTokenDto) {
       if (process.env.NODE_ENV === 'production') {
         throw new ForbiddenException('/dev/token disabled in production');
       }
       const user = await this.users.findByUsername(dto.username);
       if (!user) throw new ForbiddenException('User not found');

       const role = dto.roleId
         ? user.roles.find((r) => r.id === dto.roleId)
         : user.roles[0];
       if (!role) throw new ForbiddenException('Role not assigned');

       const issuer = process.env.AUTH_ISSUER ?? 'http://localhost:4001';
       const audience = process.env.JWT_AUDIENCE ?? 'payment-api';
       const accessToken = await this.jwtSigner.sign(
         { sub: user.id, username: user.username, roleId: role.id },
         { issuer, audience, expiresIn: '15m' },
       );
       const refreshToken = await this.jwtSigner.sign(
         { sub: user.id, username: user.username, roleId: role.id, type: 'refresh' },
         { issuer, audience, expiresIn: '8h' },
       );
       return {
         accessToken,
         refreshToken,
         role: { id: role.id, name: role.name },
         user: {
           id: user.id, username: user.username, name: user.name,
           isSuperAdmin: user.isSuperAdmin,
         },
       };
     }
   }
   ```

5. **`InternalModule`**:
   ```ts
   @Module({
     imports: [KeyPairModule, UserModule],
     providers: [InternalService, BearerAuthGuard],
     controllers: [InternalController, DevController],
   })
   export class InternalModule {}
   ```

6. **Update `UserService`** dengan method yang dipakai:
   - `findById(id)` (sudah ada dari AUTH-03).
   - `findByUsername(username)` — cari by username.
   - `findRoleById(user, roleId)` — helper.

7. **Wire** di `app.module.ts` — import `InternalModule`.

8. **Unit tests**:
   - `internal.controller.spec.ts`:
     - `GET /api/v1/me/permissions` dengan token valid → 200 + body sesuai plan2 section 10.6.
     - `GET /api/v1/me/permissions` tanpa Authorization header → 401.
     - `GET /api/v1/me/permissions` dengan token expired → 401.
     - `GET /api/v1/me/permissions` dengan user yang role-nya sudah di-unassign → 400.
     - `POST /api/v1/auth/switch-role` dengan role valid → 200 + access + refresh baru.
     - `POST /api/v1/auth/switch-role` dengan role tidak milik user → 400.
   - `dev.controller.spec.ts`:
     - `POST /dev/token` (NODE_ENV=test) → 200 + tokens.
     - `POST /dev/token` (NODE_ENV=production) → 403.
     - `POST /dev/token` dengan username tidak ada → 403.

9. **E2E test** (`apps/auth-mock/test/e2e/internal-flow.e2e-spec.ts`):
   - Issue dev token → call `GET /api/v1/me/permissions` → verify response shape.
   - Switch role → call `GET /api/v1/me/permissions` dengan token baru → verify role + permissionCodes berubah.

## Acceptance criteria

- [ ] `GET /api/v1/me/permissions` dengan Bearer token valid → 200:
  ```json
  {
    "success": true,
    "data": {
      "user": { "id": "uuid", "username": "budi_santoso", "email": "budi@perusahaan.com", "name": "Budi Santoso", "isSuperAdmin": false },
      "role": { "id": "role-uuid", "name": "HRD" },
      "permissionCodes": ["dashboard", "payment.read", "payment.write"]
    }
  }
  ```
- [ ] `GET /api/v1/me/permissions` tanpa Authorization → 401 `{ statusCode: 401, message: "Missing Bearer token" }`.
- [ ] `GET /api/v1/me/permissions` dengan token expired → 401.
- [ ] `POST /api/v1/auth/switch-role` body `{ "roleId": "<role-uuid>" }` dengan token valid + role milik user → 200:
  ```json
  {
    "success": true,
    "data": {
      "accessToken": "...",
      "refreshToken": "...",
      "role": { "id": "...", "name": "Finance" }
    }
  }
  ```
- [ ] `POST /api/v1/auth/switch-role` dengan role tidak milik user → 400.
- [ ] `POST /dev/token` body `{ "username": "superadmin" }` (NODE_ENV != production) → 200 dengan access + refresh + role + user.
- [ ] `POST /dev/token` (NODE_ENV=production) → 403.
- [ ] Token dari `/dev/token` bisa dipakai di `GET /api/v1/me/permissions` (verify roundtrip).
- [ ] Token dari `/dev/token` untuk `budi_santoso` punya `roleId` sesuai role pertama (HRD) bila `roleId` tidak diisi.
- [ ] `BearerAuthGuard` injectable + testable (mock `JwtSignerService` di unit test).
- [ ] `pnpm --filter auth-mock test` lulus.
- [ ] `pnpm --filter auth-mock typecheck` + `lint` lulus.

## Useful commands

```bash
# Start auth-mock
cd /home/z/my-project/retry-failure/apps/auth-mock && pnpm start:dev

# Step 1: Issue dev token (NODE_ENV=development)
curl -s -X POST http://localhost:4001/dev/token \
  -H "Content-Type: application/json" \
  -d '{"username":"budi_santoso"}' | jq .

# Step 2: GET /api/v1/me/permissions
TOKEN="<access_token-dari-step-1>"
curl -s http://localhost:4001/api/v1/me/permissions \
  -H "Authorization: Bearer $TOKEN" | jq .

# Step 3: Switch role (cari role_id lain dari response step 2 atau dari fixtures)
NEW_ROLE_ID="<role-id-yang-beda>"
curl -s -X POST http://localhost:4001/api/v1/auth/switch-role \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"roleId\":\"$NEW_ROLE_ID\"}" | jq .

# Step 4: Verify token baru punya roleId baru
NEW_TOKEN="<access_token-dari-step-3>"
echo "$NEW_TOKEN" | cut -d. -f2 | base64 -d 2>/dev/null | jq .  # harusnya roleId = NEW_ROLE_ID

# Step 5: Verify permissionCodes berubah sesuai role baru
curl -s http://localhost:4001/api/v1/me/permissions \
  -H "Authorization: Bearer $NEW_TOKEN" | jq '.data.role, .data.permissionCodes'

# Test guard rejection (no token)
curl -i http://localhost:4001/api/v1/me/permissions
# Expected: 401 Unauthorized

# Test guard rejection (invalid token)
curl -i http://localhost:4001/api/v1/me/permissions \
  -H "Authorization: Bearer invalid.token.here"
# Expected: 401 Unauthorized

# Test /dev/token in production mode (should fail)
NODE_ENV=production pnpm --filter auth-mock start:dev &
sleep 3
curl -i -X POST http://localhost:4001/dev/token -H "Content-Type: application/json" -d '{"username":"superadmin"}'
# Expected: 403 Forbidden
pkill -f "nest start"

# Run tests
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock test

# Run e2e specifically
cd /home/z/my-project/retry-failure/apps/auth-mock && pnpm test:e2e internal-flow.e2e-spec

# Typecheck + lint
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock typecheck
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock lint
```

## Notes

- **`BearerAuthGuard`** tidak global — pakai per-controller (`@UseGuards(BearerAuthGuard)` di `InternalController`). `DevController` tidak pakai guard (token issuance tanpa auth, hanya `NODE_ENV` check).
- **Response shape** konsisten dengan `AUTH_CONTRACT.md` section 6 + `success: true` envelope (lihat AUTH_CONTRACT).
- **Switch-role flow** (plan2 section 5.6):
  1. FE call `POST /auth/switch-role { roleId }` ke payment-api (BFF).
  2. Payment-api proxy ke `POST /api/v1/auth/switch-role` ke auth-mock.
  3. Auth-mock verify Bearer + check role milik user + issue JWT baru.
  4. Payment-api verify JWT baru (via JWKS), update session.
  5. FE refresh `/auth/session`.
- **`/dev/token`** sangat berguna untuk development payment-api (skip OAuth flow). **WAJIB** reject di production — plan2 section 9.3.2 + AUTH_CONTRACT tidak mensupport dev endpoints.
- **Token verification** di internal endpoints pakai `JwtSignerService.verify()` — private key di auth-mock, public key di JWKS. Auth-mock verify pakai private key (lebih cepat), payment-api verify pakai public key via JWKS (lebih secure — token tidak bisa di-forge).
- **Fixture users** masih placeholder (auth-mock fixtures ada di AUTH-06). Task ini assume `UserService.findById` return valid user setelah AUTH-06 jalan. Untuk testing task ini sebelum AUTH-06, isi `users` Map dengan minimal `superadmin` + `budi_santoso` stub di test setup.
- Setelah task ini selesai, AUTH-06 (fixtures) bisa mulai mengisi `UserService` dengan data sesuai plan2 section 10.4.
