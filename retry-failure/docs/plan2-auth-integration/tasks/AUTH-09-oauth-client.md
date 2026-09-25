# AUTH-09 — security — OAuth client (openid-client v5 + PKCE + token exchange)

> **Task ID**: AUTH-09
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-08
> **Estimated effort**: L (~3-4 jam)
> **Plan reference**: Section 9 (oauth-client.service.ts), Section 4.3 (PKCE), Section 4.1 (diagram OAuth2 flow), Section 2.3 (openid-client v5), Section 5.4 (refresh rotation), Section 5.6 (switch-role flow), Section 15.4 (discovery)

---

## Goal

Implementasi `OAuthClientService` di `packages/security` pakai `openid-client` v5: discovery dari `AUTH_ISSUER`, generate PKCE (`code_verifier` + `code_challenge` S256), build authorization URL, exchange code → access+refresh token, refresh token (rotation), revoke token, dan proxy switch-role ke auth `/api/v1/auth/switch-role`.

## Scope

**In scope**:
- `OAuthClientService` (`packages/security/src/oauth/oauth-client.service.ts`):
  - `discover()` — lazy discovery via `Issuer.discover(AUTH_ISSUER)`, cache issuer+client singleton.
  - `getAuthorizationUrl(params)` — generate `code_verifier` (43-128 char random), `code_challenge` (BASE64URL(SHA256(verifier))), build redirect URL ke auth `/oauth/authorize`.
  - `exchangeCode(code, codeVerifier)` — call `client.callback(redirect_uri, { code }, { code_verifier })`, return `{ accessToken, refreshToken, expiresAt, tokenType }`.
  - `refreshToken(refreshToken)` — call `client.refresh(refreshToken)`, return new tokens.
  - `revokeToken(token, tokenTypeHint)` — call `client.revoke(token, token_type_hint)`.
  - `switchRole(accessToken, roleId)` — proxy ke auth `POST /api/v1/auth/switch-role` (axios), return new tokens.
  - `fetchPermissions(accessToken)` — call auth `GET /api/v1/me/permissions` via axios, return `{ user, role, permissionCodes }`.
- PKCE helpers:
  - `generateCodeVerifier()` — 64 char random base64url (43-128 range per RFC 7636).
  - `computeCodeChallenge(verifier)` — `BASE64URL(SHA256(verifier))`.
- `OAuthClientOptions` interface — constructor params (authIssuer, clientId, clientSecret, redirectUri, scopes).
- Error handling: openid-client throws `errors.OPError` (RFC 6749 error response) dan `errors.RPError` (response parsing error). Wrap jadi `OAuthClientError` typed.
- Unit test: mock openid-client + axios.

**Out of scope**:
- Session store integration → AUTH-11 + AUTH-12.
- BFF controller endpoints (`/auth/login`, `/auth/callback`) → payment-api (separate task).
- JWKS verification → AUTH-10.
- Lazy sync middleware → AUTH-14.

## Files to create/modify

- `packages/security/src/oauth/oauth-client.service.ts` — full implementation
- `packages/security/src/oauth/oauth-client.types.ts` — types: `OAuthClientOptions`, `TokenSet`, `OAuthClientError`
- `packages/security/src/oauth/pkce.util.ts` — `generateCodeVerifier`, `computeCodeChallenge`
- `packages/security/src/oauth/index.ts` — barrel (optional, jika tidak pakai root barrel)
- `packages/security/test/oauth-client.service.spec.ts` — unit test dengan mock openid-client + axios
- `packages/security/test/pkce.util.spec.ts` — test PKCE generation per RFC 7636

## Implementation steps

1. **`pkce.util.ts`**:
   ```ts
   import { randomBytes, createHash } from 'node:crypto';

   /** RFC 7636 §4.1: 43-128 char, [A-Z][a-z][0-9]-._~ */
   export function generateCodeVerifier(length = 64): string {
     if (length < 43 || length > 128) {
       throw new Error('code_verifier length must be 43-128');
     }
     return randomBytes(length).toString('base64url').slice(0, length);
   }

   /** RFC 7636 §4.2: BASE64URL(SHA256(verifier)) for method S256 */
   export function computeCodeChallenge(verifier: string): string {
     return createHash('sha256').update(verifier).digest('base64url');
   }

   /** Generate verifier + challenge pair. */
   export function generatePkcePair(): { codeVerifier: string; codeChallenge: string; codeChallengeMethod: 'S256' } {
     const codeVerifier = generateCodeVerifier();
     const codeChallenge = computeCodeChallenge(codeVerifier);
     return { codeVerifier, codeChallenge, codeChallengeMethod: 'S256' };
   }
   ```

2. **`oauth-client.types.ts`**:
   ```ts
   export interface OAuthClientOptions {
     authIssuer: string;
     clientId: string;
     clientSecret: string;
     redirectUri: string;
     scopes: string[];
     /** Timeout for HTTP calls in ms (default: 5000) */
     httpTimeoutMs?: number;
     /** Custom user-agent (optional) */
     userAgent?: string;
   }

   export interface TokenSet {
     accessToken: string;
     refreshToken?: string;
     expiresAt: number; // unix seconds
     tokenType: 'Bearer';
     scope?: string;
   }

   export interface PermissionsResponse {
     user: {
       id: string;
       username: string;
       email?: string;
       name: string;
       isSuperAdmin: boolean;
     };
     role: { id: string; name: string };
     permissionCodes: string[];
   }

   export class OAuthClientError extends Error {
     constructor(
       message: string,
       public readonly code: string,
       public readonly status?: number,
       public readonly cause?: unknown,
     ) {
       super(message);
       this.name = 'OAuthClientError';
     }
   }
   ```

3. **`oauth-client.service.ts`** — implementasi dengan lazy discovery + singleton client:
   ```ts
   import { Injectable, Inject, Logger } from '@nestjs/common';
   import { Issuer, Client, errors as oidcErrors, TokenSet as OidcTokenSet } from 'openid-client';
   import { OAuthClientOptions, TokenSet, OAuthClientError, PermissionsResponse } from './oauth-client.types';
   import { generatePkcePair } from './pkce.util';
   import { OAUTH_PATHS } from './endpoints';
   import axios, { AxiosInstance } from 'axios';

   @Injectable()
   export class OAuthClientService {
     private readonly logger = new Logger('OAuthClientService');
     private client?: Client;
     private readonly httpClient: AxiosInstance;

     constructor(@Inject('SECURITY_OPTIONS') private readonly options: SecurityOptions) {
       this.httpClient = axios.create({
         baseURL: options.authBaseUrl,
         timeout: 5000,
         headers: { 'User-Agent': 'payment-api/0.1' },
       });
     }

     /** Lazy discovery. Cache client singleton. */
     private async getClient(): Promise<Client> {
       if (this.client) return this.client;
       try {
         const issuer = await Issuer.discover(this.options.authIssuer);
         this.client = new issuer.Client({
           client_id: this.options.oauthClientId,
           client_secret: this.options.oauthClientSecret,
           redirect_uris: [this.options.oauthRedirectUri],
           response_types: ['code'],
           token_endpoint_auth_method: 'client_secret_post',
         });
         this.logger.log(`Discovered issuer: ${issuer.metadata.issuer}`);
         return this.client;
       } catch (err) {
         throw new OAuthClientError('Discovery failed', 'discovery_failed', undefined, err);
       }
     }

     /** Step 1: build authorization URL + PKCE pair. Save verifier for callback. */
     async getAuthorizationUrl(state: string): Promise<{
       url: string;
       codeVerifier: string;
       codeChallenge: string;
       state: string;
     }> {
       const client = await this.getClient();
       const pkce = generatePkcePair();
       const url = client.authorizationUrl({
         redirect_uri: this.options.oauthRedirectUri,
         scope: this.options.oauthScopes.join(' '),
         state,
         code_challenge: pkce.codeChallenge,
         code_challenge_method: pkce.codeChallengeMethod,
       });
       return {
         url,
         codeVerifier: pkce.codeVerifier,
         codeChallenge: pkce.codeChallenge,
         state,
       };
     }

     /** Step 2: exchange code → tokens. Verify PKCE + state. */
     async exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
       const client = await this.getClient();
       try {
         const ts: OidcTokenSet = await client.callback(
           this.options.oauthRedirectUri,
           { code },
           { code_verifier: codeVerifier },
         );
         return this.toTokenSet(ts);
       } catch (err) {
         if (err instanceof oidcErrors.OPError) {
           throw new OAuthClientError(err.error || 'Token exchange failed', err.error || 'op_error', err.status);
         }
         if (err instanceof oidcErrors.RPError) {
           throw new OAuthClientError('Response parsing failed', 'rp_error', undefined, err);
         }
         throw new OAuthClientError('Unknown token exchange error', 'unknown', undefined, err);
       }
     }

     /** Step 3: refresh token (rotation — old refresh revoked by auth). */
     async refresh(refreshToken: string): Promise<TokenSet> {
       const client = await this.getClient();
       try {
         const ts = await client.refresh(refreshToken);
         return this.toTokenSet(ts);
       } catch (err) {
         if (err instanceof oidcErrors.OPError) {
           throw new OAuthClientError(err.error || 'Refresh failed', err.error || 'op_error', err.status);
         }
         throw new OAuthClientError('Unknown refresh error', 'unknown', undefined, err);
       }
     }

     /** Step 4: revoke token (RFC 7009). */
     async revoke(token: string, tokenTypeHint?: 'access_token' | 'refresh_token'): Promise<void> {
       const client = await this.getClient();
       try {
         await client.revoke(token, tokenTypeHint);
       } catch (err) {
         // RFC 7009: revoke returns 200 even if token unknown — so err means network issue
         throw new OAuthClientError('Revoke failed', 'revoke_failed', undefined, err);
       }
     }

     /** Proxy switch-role to auth /api/v1/auth/switch-role. */
     async switchRole(accessToken: string, roleId: string): Promise<TokenSet & { role: { id: string; name: string } }> {
       try {
         const res = await this.httpClient.post(
           OAUTH_PATHS.switchRole,
           { roleId },
           { headers: { Authorization: `Bearer ${accessToken}` } },
         );
         const data = res.data?.data;
         if (!data) throw new OAuthClientError('Invalid switch-role response', 'invalid_response');
         return {
           accessToken: data.accessToken,
           refreshToken: data.refreshToken,
           expiresAt: Math.floor(Date.now() / 1000) + 900, // 15m default; auth should return exp
           tokenType: 'Bearer',
           scope: this.options.oauthScopes.join(' '),
           role: data.role,
         };
       } catch (err) {
         throw new OAuthClientError('Switch role failed', 'switch_role_failed', err?.response?.status, err);
       }
     }

     /** Fetch user + role + permissionCodes (lazy sync source). */
     async fetchPermissions(accessToken: string): Promise<PermissionsResponse> {
       try {
         const res = await this.httpClient.get(OAUTH_PATHS.permissions, {
           headers: { Authorization: `Bearer ${accessToken}` },
         });
         const data = res.data?.data;
         if (!data) throw new OAuthClientError('Invalid permissions response', 'invalid_response');
         return data;
       } catch (err) {
         throw new OAuthClientError('Fetch permissions failed', 'fetch_permissions_failed', err?.response?.status, err);
       }
     }

     private toTokenSet(ts: OidcTokenSet): TokenSet {
       return {
         accessToken: ts.access_token,
         refreshToken: ts.refresh_token,
         expiresAt: ts.expires_at ?? Math.floor(Date.now() / 1000) + 900,
         tokenType: 'Bearer',
         scope: ts.scope,
       };
     }
   }
   ```

4. **Unit test** (`packages/security/test/oauth-client.service.spec.ts`):
   - Mock `openid-client` (`Issuer.discover`, `Client.prototype.authorizationUrl`, `callback`, `refresh`, `revoke`).
   - Mock `axios` (atau pakai `nock`).
   - Test:
     - `getAuthorizationUrl` → URL contains `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`.
     - `exchangeCode` valid → return TokenSet.
     - `exchangeCode` PKCE mismatch → throw `OAuthClientError` with code `invalid_grant`.
     - `refresh` valid → return new TokenSet.
     - `refresh` reuse detected (auth returns 400) → throw.
     - `revoke` valid → resolve void.
     - `revoke` unknown token → resolve void (RFC 7009).
     - `switchRole` valid → return new tokens + role.
     - `switchRole` role not assigned → throw.
     - `fetchPermissions` valid → return user + role + permissionCodes.
     - `fetchPermissions` 401 → throw.
     - Discovery failed (network) → throw `OAuthClientError` code `discovery_failed`.

5. **PKCE test** (`packages/security/test/pkce.util.spec.ts`):
   - `generateCodeVerifier` length 64 (default).
   - `generateCodeVerifier` length 43 (min) + 128 (max) OK.
   - `generateCodeVerifier` length < 43 or > 128 → throw.
   - `computeCodeChallenge` SHA-256 base64url (test vector dari RFC 7636 appendix B: verifier `dBjftJeZ4CVKjm7gZ6Ttw...` → challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`).
   - Same verifier → same challenge (deterministic).

## Acceptance criteria

- [ ] `OAuthClientService` dapat di-inject di NestJS module (`@Injectable()`).
- [ ] `discover()` lazy + cache singleton `Client`.
- [ ] `getAuthorizationUrl(state)` return URL dengan: `response_type=code`, `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method=S256`, `scope`.
- [ ] `exchangeCode(code, codeVerifier)` return `TokenSet` dengan `accessToken`, `refreshToken`, `expiresAt`, `tokenType: 'Bearer'`, `scope`.
- [ ] `refresh(refreshToken)` return new `TokenSet` (rotation).
- [ ] `revoke(token, hint)` resolve void bila success.
- [ ] `switchRole(accessToken, roleId)` return new tokens + `role`.
- [ ] `fetchPermissions(accessToken)` return `{ user, role, permissionCodes }` per plan2 section 10.6.
- [ ] PKCE verifier 64 char (default), dalam range 43-128, base64url charset.
- [ ] PKCE challenge = `BASE64URL(SHA256(verifier))` — test vector RFC 7636.
- [ ] `OAuthClientError` typed error dengan `code`, `status`, `cause`.
- [ ] openid-client `OPError` (auth returns error) → wrap jadi `OAuthClientError`.
- [ ] openid-client `RPError` (response parse) → wrap jadi `OAuthClientError`.
- [ ] Unit test `oauth-client.service.spec.ts` lulus (semua scenarios).
- [ ] PKCE test `pkce.util.spec.ts` lulus (termasuk RFC 7636 test vector).
- [ ] `pnpm --filter @retry-failure/security typecheck` + `lint` lulus.

## Useful commands

```bash
# Typecheck
cd  && pnpm --filter @retry-failure/security typecheck

# Lint
cd  && pnpm --filter @retry-failure/security lint

# Test (semua spec)
cd  && pnpm --filter @retry-failure/security test

# Test specific file
cd /packages/security && pnpm test pkce.util.spec.ts

# Verify RFC 7636 test vector manual
node -e "
const { createHash } = require('crypto');
const verifier = 'dBjftJeZ4CVKjm7gZ6Tw_vmiyqY7LB7ZWHgLKa8OWn4Grkzm.Y9toSiqK5XmvohfcZR.rIFQdw2wTapLnE25t8xKuIoyg';
const challenge = createHash('sha256').update(verifier).digest('base64url');
console.log(challenge);
// Expected: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
"

# Integration test manual (butuh auth-mock running)
# 1. Start auth-mock
cd /apps/auth-mock && pnpm start:dev &

# 2. Get dev token (skip OAuth flow)
TOKEN=$(curl -s -X POST http://localhost:4001/dev/token -H 'Content-Type: application/json' -d '{"username":"budi_santoso"}' | jq -r .accessToken)

# 3. Test fetchPermissions via axios (atau curl)
curl -s http://localhost:4001/api/v1/me/permissions -H "Authorization: Bearer $TOKEN" | jq .

pkill -f "nest start"
```

## Notes

- **`openid-client` v5** API (per plan2 section 2.3):
  - `Issuer.discover(url)` — async, return `Issuer` instance.
  - `new issuer.Client(metadata)` — create `Client`.
  - `client.authorizationUrl(params)` — return string URL.
  - `client.callback(redirect_uri, params, checks)` — async, return `TokenSet`.
  - `client.refresh(refreshToken)` — async, return new `TokenSet`.
  - `client.revoke(token, hint)` — async, void.
- **Discovery lazy + cached** — first call slow (~200ms untuk HTTP discover). Subsequent calls return cached client. Alternative: discovery di `OnModuleInit` (fail fast bila auth down saat boot). Trade-off: lazy lebih resilient (auth bisa up setelah payment-api start).
- **PKCE wajib** meski confidential client (RFC 9700 §2.1.1, plan2 section 4.3). Verifier 64 char random base64url = ~384 bit entropy, lebih dari cukup.
- **State validation** — `state` parameter anti-CSRF. Save ke session store (short-lived) atau signed cookie. Verify di callback. (Detail implementasi state di BFF controller, bukan di OAuthClientService.)
- **Token type** — openid-client v5 return `TokenSet` dari `openid-client`. Property: `access_token`, `refresh_token`, `expires_at`, `token_type`, `scope`, `id_token`. Konversi ke internal `TokenSet` untuk konsistensi.
- **Error wrapping** — `OPError` (RFC 6749 §5.2 error response dari auth: `invalid_grant`, `invalid_client`, dll) dan `RPError` (response parsing issue). Wrap jadi `OAuthClientError` supaya caller tidak perlu import `openid-client` types.
- **`fetchPermissions`** — axios call ke `GET /api/v1/me/permissions`. Tidak pakai openid-client (tidak ada method untuk endpoint custom). Bisa pakai `client.requestResource` (v5) tapi axios lebih familiar.
- **`switchRole`** — proxy ke auth `POST /api/v1/auth/switch-role`. Return new tokens (auth issue JWT baru dengan roleId baru). Plan2 section 5.6 flow.
- Setelah task ini selesai, AUTH-10 (JWKS verifier) bisa mulai — supaya payment-api bisa verify token yang diterima dari OAuth flow.
