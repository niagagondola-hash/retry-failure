# AUTH-03 — auth-mock OAuth2 endpoints (authorize + token + revoke + PKCE)

> **Task ID**: AUTH-03
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-01, AUTH-02
> **Estimated effort**: L (~3-4 jam)
> **Plan reference**: Section 10.1 (endpoint scope), Section 4.1 (diagram OAuth2 flow), Section 4.3 (PKCE), Section 10.2 (client registration), Section 10.5 (multi-role flow), Section 5.1-5.5 (token strategy), Section 9.1 (OAUTH_PATHS)

---

## Goal

Implementasi endpoint OAuth2 lengkap di `auth-mock` mengikuti RFC 6749 + RFC 7636 (PKCE): `GET /oauth/authorize`, `POST /oauth/authorize` (login submit), `POST /oauth/select-role`, `POST /oauth/token` (authorization_code + refresh_token grant), `POST /oauth/revoke`. Termasuk authorization code store (in-memory), PKCE S256 verification, dan token signing RS256 via `JwtSignerService` (AUTH-02).

## Scope

**In scope**:
- `GET /oauth/authorize` — validasi `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`; render login.ejs (atau redirect kalau user sudah login via auth_sid cookie).
- `POST /oauth/authorize` — submit login (username + password); validate via `UserService` (placeholder, fixtures di AUTH-06); buat auth session cookie `auth_sid`.
- `POST /oauth/select-role` — pilih role dari multi-role user; issue authorization code + redirect.
- `POST /oauth/token`:
  - `grant_type=authorization_code`: tukar code → access_token (JWT RS256, 15m) + refresh_token (JWT, 8h), verify `code_verifier` PKCE.
  - `grant_type=refresh_token`: tukar refresh_token lama → access baru + refresh baru (rotation, revoke refresh lama).
- `POST /oauth/revoke` — revoke access + refresh token (tandai revoked di store).
- Authorization code store (in-memory `Map` dengan TTL 60s).
- Refresh token rotation + reuse detection (revoke semua sesi user bila refresh lama dipakai lagi).
- `OAuthService` — business logic: storeAuthorizationCode, consumeAuthorizationCode, issueTokenPair, revokeToken, validatePkce.
- DTOs: `AuthorizeQueryDto`, `AuthorizeSubmitDto`, `SelectRoleDto`, `TokenRequestDto`, `RevokeDto` (class-validator).

**Out of scope**:
- Login UI (EJS templates) → AUTH-04 (task ini panggil `res.render('login', {...})` tapi templates dibuat di AUTH-04).
- Internal endpoints (`/api/v1/me/permissions`, `/api/v1/auth/switch-role`, `/dev/token`) → AUTH-05.
- Fixture users/roles/permissions (data) → AUTH-06 (task ini pakai `UserService.findById` interface, fixtures di AUTH-06).
- OIDC discovery → AUTH-07.
- Client management UI → tidak ada, client registration hardcoded (plan2 section 10.2).

## Files to create/modify

- `apps/auth-mock/src/modules/oauth/dto/authorize-query.dto.ts`
- `apps/auth-mock/src/modules/oauth/dto/authorize-submit.dto.ts`
- `apps/auth-mock/src/modules/oauth/dto/select-role.dto.ts`
- `apps/auth-mock/src/modules/oauth/dto/token-request.dto.ts`
- `apps/auth-mock/src/modules/oauth/dto/revoke.dto.ts`
- `apps/auth-mock/src/modules/oauth/oauth.controller.ts` — GET/POST /oauth/authorize, POST /oauth/select-role
- `apps/auth-mock/src/modules/oauth/token.controller.ts` — POST /oauth/token, POST /oauth/revoke
- `apps/auth-mock/src/modules/oauth/oauth.service.ts` — business logic (auth code store, token issuance, PKCE verify, refresh rotation)
- `apps/auth-mock/src/modules/oauth/auth-session.service.ts` — auth_sid cookie session (in-memory)
- `apps/auth-mock/src/modules/oauth/auth-code.store.ts` — authorization code store (in-memory, TTL 60s)
- `apps/auth-mock/src/modules/oauth/token.store.ts` — refresh token store (rotation + reuse detection)
- `apps/auth-mock/src/modules/oauth/oauth.module.ts` — wire everything
- `apps/auth-mock/src/modules/client/client.service.ts` — hardcoded client `payment-api` (per plan2 section 10.2)
- `apps/auth-mock/src/modules/client/client.module.ts`
- `apps/auth-mock/src/modules/user/user.service.ts` — `validateCredentials`, `findById`, `listRoles` (stub; fixtures di AUTH-06)
- `apps/auth-mock/src/modules/user/user.module.ts`
- `apps/auth-mock/src/app.module.ts` — verify imports
- `apps/auth-mock/test/oauth.controller.spec.ts`
- `apps/auth-mock/test/token.controller.spec.ts`
- `apps/auth-mock/test/oauth.service.spec.ts` — PKCE verification, code TTL, refresh rotation, reuse detection

## Implementation steps

1. **Client registration** (`apps/auth-mock/src/modules/client/client.service.ts`):
   ```ts
   import { Injectable } from '@nestjs/common';

   export interface OAuthClient {
     clientId: string;
     clientSecret: string;
     redirectUris: string[];
     grantTypes: string[];
     scopes: string[];
     tokenEndpointAuthMethod: 'client_secret_post' | 'client_secret_basic';
   }

   @Injectable()
   export class ClientService {
     private readonly clients = new Map<string, OAuthClient>();

     constructor() {
       // Per plan2 section 10.2
       this.clients.set('payment-api', {
         clientId: 'payment-api',
         clientSecret: process.env.OAUTH_CLIENT_SECRET ?? 'dev-client-secret',
         redirectUris: ['http://localhost:3001/auth/callback'],
         grantTypes: ['authorization_code', 'refresh_token'],
         scopes: ['openid', 'profile', 'payment.read', 'payment.write'],
         tokenEndpointAuthMethod: 'client_secret_post',
       });
     }

     findById(clientId: string): OAuthClient | undefined {
       return this.clients.get(clientId);
     }

     validateClientCredentials(clientId: string, clientSecret: string): boolean {
       const c = this.findById(clientId);
       return !!c && c.clientSecret === clientSecret;
     }
   }
   ```

2. **User service stub** (`apps/auth-mock/src/modules/user/user.service.ts`) — interface lengkap, fixtures di AUTH-06:
   ```ts
   import { Injectable } from '@nestjs/common';

   export interface Role {
     id: string;
     name: string;
     description?: string;
     permissionCodes: string[];
   }

   export interface MockUser {
     id: string;
     username: string;
     passwordHash: string; // plain for dev (NOT for prod)
     email?: string;
     name: string;
     isSuperAdmin: boolean;
     roles: Role[];
   }

   @Injectable()
   export class UserService {
     private readonly users = new Map<string, MockUser>(); // fixtures filled by AUTH-06

     async validateCredentials(username: string, password: string): Promise<MockUser | null> {
       const user = [...this.users.values()].find((u) => u.username === username);
       if (!user) return null;
       if (user.passwordHash !== password) return null;
       return user;
     }

     async findById(id: string): Promise<MockUser | null> {
       return this.users.get(id) ?? null;
     }
   }
   ```

3. **Auth code store** (`apps/auth-mock/src/modules/oauth/auth-code.store.ts`):
   ```ts
   import { Injectable, OnModuleDestroy } from '@nestjs/common';

   export interface StoredAuthCode {
     code: string;
     clientId: string;
     userId: string;
     roleId: string;
     redirectUri: string;
     codeChallenge: string;
     codeChallengeMethod: 'S256';
     scope: string;
     expiresAt: number;
     consumed: boolean;
   }

   @Injectable()
   export class AuthCodeStore implements OnModuleDestroy {
     private readonly codes = new Map<string, StoredAuthCode>();
     private readonly ttlMs = 60_000; // 60s per RFC 6749

     async store(entry: StoredAuthCode): Promise<void> {
       this.codes.set(entry.code, entry);
       setTimeout(() => this.codes.delete(entry.code), this.ttlMs).unref?.();
     }

     async consume(code: string): Promise<StoredAuthCode | null> {
       const entry = this.codes.get(code);
       if (!entry) return null;
       if (entry.consumed) return null; // one-time use
       if (Date.now() > entry.expiresAt) {
         this.codes.delete(code);
         return null;
       }
       entry.consumed = true;
       return entry;
     }

     onModuleDestroy() { this.codes.clear(); }
   }
   ```

4. **Token store** dengan rotation + reuse detection (`apps/auth-mock/src/modules/oauth/token.store.ts`):
   ```ts
   import { Injectable, OnModuleDestroy } from '@nestjs/common';

   interface StoredToken {
     jti: string;
     userId: string;
     clientId: string;
     roleId: string;
     type: 'access' | 'refresh';
     expiresAt: number;
     revoked: boolean;
   }

   @Injectable()
   export class TokenStore implements OnModuleDestroy {
     private readonly tokens = new Map<string, StoredToken>();
     private readonly userSessions = new Map<string, Set<string>>(); // userId -> jti set

     async store(token: StoredToken): Promise<void> {
       this.tokens.set(token.jti, token);
       if (!this.userSessions.has(token.userId)) {
         this.userSessions.set(token.userId, new Set());
       }
       this.userSessions.get(token.userId)!.add(token.jti);
     }

     async isRevoked(jti: string): Promise<boolean> {
       const t = this.tokens.get(jti);
       return !t || t.revoked;
     }

     async revoke(jti: string): Promise<void> {
       const t = this.tokens.get(jti);
       if (t) t.revoked = true;
     }

     async revokeAllForUser(userId: string): Promise<void> {
       const session = this.userSessions.get(userId);
       if (!session) return;
       for (const jti of session) {
         const t = this.tokens.get(jti);
         if (t) t.revoked = true;
       }
     }

     /** Reuse detection: refresh lama yang sudah revoked → revoke semua sesi user. */
     async detectReuseAndPanic(jti: string): Promise<boolean> {
       const t = this.tokens.get(jti);
       if (!t) return false;
       if (t.type === 'refresh' && t.revoked) {
         await this.revokeAllForUser(t.userId);
         return true;
       }
       return false;
     }

     onModuleDestroy() { this.tokens.clear(); this.userSessions.clear(); }
   }
   ```

5. **PKCE verification** (di `oauth.service.ts`):
   ```ts
   import { createHash } from 'node:crypto';

   function verifyPkce(codeVerifier: string, codeChallenge: string, method: string): boolean {
     if (method !== 'S256') return false;
     if (codeVerifier.length < 43 || codeVerifier.length > 128) return false;
     const hash = createHash('sha256').update(codeVerifier).digest('base64url');
     return hash === codeChallenge;
   }
   ```

6. **OAuthService** (`apps/auth-mock/src/modules/oauth/oauth.service.ts`):
   - `getAuthSession(req)` → baca cookie `auth_sid`, lookup in-memory auth session store.
   - `createAuthSession(res, user)` → set cookie `auth_sid` HttpOnly + SameSite=Lax.
   - `storeAuthorizationCode(entry)` → store di `AuthCodeStore`.
   - `issueCodeAndRedirect(res, query, user, roleId)` → generate code, store, redirect ke `redirect_uri?code=...&state=...`.
   - `exchangeCode({ code, code_verifier, client_id, client_secret, redirect_uri })` → consume code, verify PKCE, verify client creds, issue access+refresh via `JwtSignerService`.
   - `refreshToken({ refresh_token, client_id, client_secret })` → verify refresh token (not expired, not revoked), detect reuse, rotate (revoke old, issue new).
   - `revoke({ token, client_id, client_secret })` → revoke token.

7. **OAuthController** (`apps/auth-mock/src/modules/oauth/oauth.controller.ts`) — implementasi sesuai plan2 section 10.7.3:
   - `GET /oauth/authorize` — validasi client + redirect_uri + PKCE; render `login` atau `select-role` atau langsung issue code (single-role).
   - `POST /oauth/authorize` — submit login; validate credentials; create auth session; render role selection atau issue code.
   - `POST /oauth/select-role` — validasi role milik user; issue code + redirect.

8. **TokenController** (`apps/auth-mock/src/modules/oauth/token.controller.ts`):
   - `POST /oauth/token` — body: `grant_type`, `code`/`refresh_token`, `code_verifier`/`client_id`, `client_secret`, `redirect_uri`. Response:
     ```json
     {
       "access_token": "eyJhbGc...",
       "token_type": "Bearer",
       "expires_in": 900,
       "refresh_token": "eyJhbGc...",
       "scope": "openid profile"
     }
     ```
   - `POST /oauth/revoke` — body: `token`, `token_type_hint`, `client_id`, `client_secret`. Return `200 OK` (per RFC 7009).

9. **Wire module** (`apps/auth-mock/src/modules/oauth/oauth.module.ts`):
   ```ts
   @Module({
     imports: [KeyPairModule, ClientModule, UserModule],
     providers: [OAuthService, AuthSessionService, AuthCodeStore, TokenStore],
     controllers: [OAuthController, TokenController],
     exports: [OAuthService, TokenStore],
   })
   export class OAuthModule {}
   ```

10. **JWT payload** (per plan2 section 5.2) — access token:
    ```json
    {
      "sub": "user-uuid",
      "username": "budi_santoso",
      "roleId": "role-uuid",
      "iss": "http://localhost:4001",
      "aud": "payment-api",
      "exp": 1730000000,
      "iat": 1729999100,
      "jti": "unique-token-id"
    }
    ```
    Refresh token: tambahan `type: "refresh"` + `exp: 8h`.

11. **Unit tests**:
    - `oauth.service.spec.ts`: PKCE verification (valid S256, invalid method, wrong verifier), auth code TTL (expired → null), code consumption (one-time use).
    - `token.controller.spec.ts`: token exchange happy path, PKCE mismatch → 400, refresh rotation, reuse detection → semua sesi user di-revoke, revoke unknown token → 200 (RFC 7009).

12. **Integration test** (test full flow):
    - Generate code → exchange → access token + refresh token.
    - Verify access token via JWKS (`/.well-known/jwks.json`).

## Acceptance criteria

- [ ] `GET /oauth/authorize?...` (valid client + redirect + PKCE) → 200 render login page (atau redirect kalau single-role user sudah login).
- [ ] `GET /oauth/authorize?client_id=invalid` → 400 render error page.
- [ ] `GET /oauth/authorize?...&code_challenge_method=plain` → 400 (S256 wajib).
- [ ] `POST /oauth/authorize` (valid credentials) → set auth_sid cookie + render select-role (multi-role) atau redirect dengan code (single-role).
- [ ] `POST /oauth/authorize` (invalid credentials) → 401 render login page dengan error message.
- [ ] `POST /oauth/select-role` → redirect ke `redirect_uri?code=...&state=...`.
- [ ] `POST /oauth/token` `grant_type=authorization_code`:
  - Valid code + PKCE → 200 dengan `access_token` + `refresh_token` (JWT RS256).
  - Invalid `code_verifier` → 400 `invalid_grant`.
  - Code expired (>60s) → 400 `invalid_grant`.
  - Code sudah dipakai (one-time) → 400 `invalid_grant`.
  - Invalid client credentials → 401 `invalid_client`.
- [ ] `POST /oauth/token` `grant_type=refresh_token`:
  - Valid refresh → 200 dengan access + refresh baru, refresh lama revoked.
  - Refresh lama dipakai lagi → 400 `invalid_grant` + revoke semua sesi user.
- [ ] `POST /oauth/revoke`:
  - Token valid → 200 OK, token marked revoked di `TokenStore`.
  - Token tidak ada → 200 OK (RFC 7009 tidak boleh expose).
- [ ] JWT access token memiliki: `sub`, `username`, `roleId`, `iss`, `aud`, `exp`, `iat`, `jti` (per plan2 section 5.2).
- [ ] JWT access token expiry 15 menit (`expires_in: 900`).
- [ ] JWT refresh token expiry 8 jam.
- [ ] JWT header memiliki `kid` (cocok dengan JWKS).
- [ ] `pnpm --filter auth-mock test` lulus semua spec.
- [ ] `pnpm --filter auth-mock typecheck` lulus.
- [ ] `pnpm --filter auth-mock lint` lulus.

## Useful commands

```bash
# Start auth-mock
cd /apps/auth-mock && pnpm start:dev

# Step 1: GET /oauth/authorize (trigger login page)
curl -i "http://localhost:4001/oauth/authorize?response_type=code&client_id=payment-api&redirect_uri=http://localhost:3001/auth/callback&state=abc123&code_challenge=$(node -e "console.log(require('crypto').createHash('sha256').update('verifier123456789012345678901234567890123456789012').digest('base64url'))")&code_challenge_method=S256&scope=openid%20profile"
# Expected: 200 + HTML login page

# Step 2: POST /oauth/authorize (submit login)
curl -i -c /tmp/auth-cookies.txt -X POST http://localhost:4001/oauth/authorize \
  -d "username=budi_santoso&password=ChangeMe_123!&client_id=payment-api&redirect_uri=http://localhost:3001/auth/callback&state=abc123&code_challenge=<challenge>&code_challenge_method=S256&scope=openid"
# Expected: 302 redirect ke /oauth/select-role ATAU langsung ke redirect_uri?code=...

# Step 3: POST /oauth/token (exchange code)
CODE="<code-dari-step-2>"
curl -s -X POST http://localhost:4001/oauth/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=$CODE&redirect_uri=http://localhost:3001/auth/callback&client_id=payment-api&client_secret=dev-client-secret&code_verifier=verifier123456789012345678901234567890123456789012" | jq .

# Step 4: Refresh token
REFRESH="<refresh_token-dari-step-3>"
curl -s -X POST http://localhost:4001/oauth/token \
  -d "grant_type=refresh_token&refresh_token=$REFRESH&client_id=payment-api&client_secret=dev-client-secret" | jq .

# Step 5: Revoke
curl -i -X POST http://localhost:4001/oauth/revoke \
  -d "token=<access_or_refresh>&client_id=payment-api&client_secret=dev-client-secret"

# Run tests
cd  && pnpm --filter auth-mock test

# Decode access token (paste token, ambil header + payload)
echo "<access_token>" | cut -d. -f1 | base64 -d 2>/dev/null | jq .  # header
echo "<access_token>" | cut -d. -f2 | base64 -d 2>/dev/null | jq .  # payload

# Verify token via JWKS public key (script test sederhana)
node -e "
const { createRemoteJWKSet, jwtVerify } = require('jose');
const jwks = createRemoteJWKSet(new URL('http://localhost:4001/.well-known/jwks.json'));
(async () => {
  const { payload } = await jwtVerify('<access_token>', jwks, { audience: 'payment-api', issuer: 'http://localhost:4001' });
  console.log(JSON.stringify(payload, null, 2));
})();
"

# Typecheck + lint
cd  && pnpm --filter auth-mock typecheck
cd  && pnpm --filter auth-mock lint
```

## Notes

- **PKCE wajib** meski client confidential (RFC 9700 §2.1.1, plan2 section 4.3). Tolak `code_challenge_method=plain`.
- **Code verifier length**: 43-128 karakter (RFC 7636 §4.1).
- **Code TTL**: 60 detik (RFC 6749 §4.2.2 merekomendasikan 10 menit max, kita pakai 60s untuk safety).
- **Refresh rotation**: setiap refresh → refresh baru + revoke refresh lama. Reuse → revoke semua sesi user (plan2 section 5.4).
- **`token_type_hint`** di `/oauth/revoke` hanya hint, server tetap cari di semua token types (RFC 7009 §2.1).
- **`TokenStore` in-memory** cukup untuk mock. Production: Redis dengan TTL per-token.
- **Auth session cookie** (`auth_sid`) terpisah dari payment-api session (`sid`) — plan2 section 10.7.9. HttpOnly + SameSite=Lax + 1 jam TTL.
- **Multi-role flow** (plan2 section 10.5): setelah login, kalau user multi-role → render select-role. Single-role → langsung issue code.
- Setelah task ini selesai, AUTH-04 (login UI) bisa render templates yang sudah dipanggil controller.
