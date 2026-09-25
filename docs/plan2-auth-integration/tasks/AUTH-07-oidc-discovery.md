# AUTH-07 — auth-mock OIDC discovery endpoint

> **Task ID**: AUTH-07
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-02 (JWKS endpoint sudah ada)
> **Estimated effort**: S (~30 min)
> **Plan reference**: Section 10.1 (scope — `/.well-known/openid-configuration`), Section 25.3.H (discovery JSON), Section 9.1 (OAUTH_PATHS.discovery), Section 15.4 (evolusi ke OIDC discovery), AUTH_CONTRACT.md section 2

---

## Goal

Implementasi `GET /.well-known/openid-configuration` di auth-mock yang mengembalikan OIDC discovery document lengkap sesuai plan2 section 25.3.H. Endpoint ini dipakai `openid-client` v5 di `packages/security` (AUTH-09) untuk auto-discover issuer endpoints, mengurangi env configuration di payment-api.

## Scope

**In scope**:
- `GET /.well-known/openid-configuration`:
  - Return OIDC discovery JSON sesuai plan2 section 25.3.H.
  - URLs absolute (`http://localhost:4001/oauth/authorize`, dst.) dibangun dari `AUTH_ISSUER` env atau dari request `host` header.
  - Cache-Control: `public, max-age=3600` (1 jam — discovery jarang berubah).
- `DiscoveryController` — single route, no auth.
- Unit test verify response shape + absolute URLs.

**Out of scope**:
- `/oauth/userinfo` endpoint — plan2 section 10.1 mention sebagai "opsional". Skip untuk mock (tidak dipakai payment-api).
- Dynamic discovery (auto-update saat keypair rotate) — statis untuk dev.
- Discovery untuk multi-tenant — tidak, single issuer.
- OpenAPI spec (`auth-openapi.json`) — file terpisah, di-task terpisah.

## Files to create/modify

- `apps/auth-mock/src/modules/discovery/discovery.module.ts`
- `apps/auth-mock/src/modules/discovery/discovery.controller.ts`
- `apps/auth-mock/src/modules/discovery/discovery.service.ts` — build discovery document
- `apps/auth-mock/test/discovery.controller.spec.ts`
- `apps/auth-mock/src/app.module.ts` — import `DiscoveryModule`

## Implementation steps

1. **`DiscoveryService`** (`apps/auth-mock/src/modules/discovery/discovery.service.ts`):
   ```ts
   import { Injectable } from '@nestjs/common';

   @Injectable()
   export class DiscoveryService {
     /**
      * Build discovery document.
      * Issuer URL diambil dari AUTH_ISSUER env (default http://localhost:4001).
      * URLs di-absolute-kan ke issuer base.
      */
     buildDiscovery(issuerOverride?: string): Record<string, unknown> {
       const issuer = issuerOverride ?? process.env.AUTH_ISSUER ?? 'http://localhost:4001';
       const base = issuer.replace(/\/+$/, ''); // strip trailing slash

       return {
         issuer,
         authorization_endpoint: `${base}/oauth/authorize`,
         token_endpoint: `${base}/oauth/token`,
         revocation_endpoint: `${base}/oauth/revoke`,
         jwks_uri: `${base}/.well-known/jwks.json`,
         userinfo_endpoint: `${base}/oauth/userinfo`, // optional, may be unused
         response_types_supported: ['code'],
         grant_types_supported: ['authorization_code', 'refresh_token'],
         code_challenge_methods_supported: ['S256'],
         scopes_supported: ['openid', 'profile', 'payment.read', 'payment.write'],
         token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
         id_token_signing_alg_values_supported: ['RS256'],
         subject_types_supported: ['public'],
         claims_supported: [
           'sub', 'username', 'roleId', 'iss', 'aud', 'exp', 'iat', 'jti',
         ],
       };
     }
   }
   ```

2. **`DiscoveryController`** (`apps/auth-mock/src/modules/discovery/discovery.controller.ts`):
   ```ts
   import { Controller, Get, Header, Req } from '@nestjs/common';
   import { Request } from 'express';
   import { DiscoveryService } from './discovery.service';

   @Controller()
   export class DiscoveryController {
     constructor(private readonly discovery: DiscoveryService) {}

     @Get('.well-known/openid-configuration')
     @Header('Cache-Control', 'public, max-age=3600')
     @Header('Content-Type', 'application/json; charset=utf-8')
     discover() {
       // Prefer AUTH_ISSUER env (stable, matches JWT iss claim).
       // Bila env tidak set, fallback ke request host (berguna untuk dev via proxy).
       return this.discovery.buildDiscovery(process.env.AUTH_ISSUER);
     }
   }
   ```

3. **`DiscoveryModule`**:
   ```ts
   import { Module } from '@nestjs/common';
   import { DiscoveryService } from './discovery.service';
   import { DiscoveryController } from './discovery.controller';

   @Module({
     providers: [DiscoveryService],
     controllers: [DiscoveryController],
   })
   export class DiscoveryModule {}
   ```

4. **Update `app.module.ts`** — import `DiscoveryModule`.

5. **Unit test** (`apps/auth-mock/test/discovery.controller.spec.ts`):
   ```ts
   describe('DiscoveryController', () => {
     let controller: DiscoveryController;
     beforeEach(async () => {
       const mod = await Test.createTestingModule({
         providers: [DiscoveryService],
         controllers: [DiscoveryController],
       }).compile();
       controller = mod.get(DiscoveryController);
     });

     it('returns discovery document with absolute URLs', () => {
       process.env.AUTH_ISSUER = 'http://localhost:4001';
       const doc = controller.discover();
       expect(doc.issuer).toBe('http://localhost:4001');
       expect(doc.authorization_endpoint).toBe('http://localhost:4001/oauth/authorize');
       expect(doc.token_endpoint).toBe('http://localhost:4001/oauth/token');
       expect(doc.revocation_endpoint).toBe('http://localhost:4001/oauth/revoke');
       expect(doc.jwks_uri).toBe('http://localhost:4001/.well-known/jwks.json');
     });

     it('supports S256 PKCE only', () => {
       const doc = controller.discover();
       expect(doc.code_challenge_methods_supported).toEqual(['S256']);
     });

     it('supports authorization_code + refresh_token grants', () => {
       const doc = controller.discover();
       expect(doc.grant_types_supported).toEqual(
         expect.arrayContaining(['authorization_code', 'refresh_token']),
       );
     });

     it('lists RS256 as signing alg', () => {
       const doc = controller.discover();
       expect(doc.id_token_signing_alg_values_supported).toEqual(['RS256']);
     });

     it('lists all JWT claims from AUTH_CONTRACT section 4', () => {
       const doc = controller.discover();
       expect(doc.claims_supported).toEqual(
         expect.arrayContaining([
           'sub', 'username', 'roleId', 'iss', 'aud', 'exp', 'iat', 'jti',
         ]),
       );
     });

     it('lists scopes from AUTH_CONTRACT section 9', () => {
       const doc = controller.discover();
       expect(doc.scopes_supported).toEqual(
         expect.arrayContaining(['openid', 'profile', 'payment.read', 'payment.write']),
       );
     });

     it('strips trailing slash from issuer', () => {
       process.env.AUTH_ISSUER = 'http://localhost:4001/';
       const doc = controller.discover();
       expect(doc.issuer).toBe('http://localhost:4001');
       expect(doc.authorization_endpoint).toBe('http://localhost:4001/oauth/authorize');
     });
   });
   ```

6. **Integration verification** — jalankan auth-mock + curl discovery endpoint:
   ```bash
   curl http://localhost:4001/.well-known/openid-configuration | jq .
   ```

## Acceptance criteria

- [ ] `GET /.well-known/openid-configuration` return 200 dengan body JSON sesuai plan2 section 25.3.H:
  ```json
  {
    "issuer": "http://localhost:4001",
    "authorization_endpoint": "http://localhost:4001/oauth/authorize",
    "token_endpoint": "http://localhost:4001/oauth/token",
    "revocation_endpoint": "http://localhost:4001/oauth/revoke",
    "jwks_uri": "http://localhost:4001/.well-known/jwks.json",
    "response_types_supported": ["code"],
    "grant_types_supported": ["authorization_code", "refresh_token"],
    "code_challenge_methods_supported": ["S256"],
    "scopes_supported": ["openid", "profile", "payment.read", "payment.write"],
    "token_endpoint_auth_methods_supported": ["client_secret_post", "client_secret_basic"]
  }
  ```
- [ ] URLs absolute (tidak relative path).
- [ ] Trailing slash di-stripped dari `issuer` env.
- [ ] Response header `Cache-Control: public, max-age=3600`.
- [ ] Response header `Content-Type: application/json; charset=utf-8`.
- [ ] `scopes_supported` konsisten dengan AUTH_CONTRACT section 9.
- [ ] `claims_supported` mencakup semua claims dari AUTH_CONTRACT section 4 (`sub`, `username`, `roleId`, `iss`, `aud`, `exp`, `iat`, `jti`).
- [ ] `code_challenge_methods_supported: ["S256"]` (tidak ada `plain`).
- [ ] `id_token_signing_alg_values_supported: ["RS256"]`.
- [ ] `pnpm --filter auth-mock test` lulus (spec baru + existing).
- [ ] `pnpm --filter auth-mock typecheck` + `lint` lulus.

## Useful commands

```bash
# Start auth-mock + verify discovery
cd /home/z/my-project/retry-failure/apps/auth-mock && pnpm start:dev

# Get discovery document
curl -s http://localhost:4001/.well-known/openid-configuration | jq .

# Verify response headers
curl -sI http://localhost:4001/.well-known/openid-configuration | head -10
# Expected: Cache-Control: public, max-age=3600
#           Content-Type: application/json; charset=utf-8

# Test with AUTH_ISSUER env set to different host
AUTH_ISSUER=https://auth.example.com pnpm --filter auth-mock start:dev &
sleep 3
curl -s http://localhost:4001/.well-known/openid-configuration | jq .issuer
# Expected: "https://auth.example.com"
pkill -f "nest start"

# Test trailing slash stripping
AUTH_ISSUER=http://localhost:4001/ pnpm --filter auth-mock start:dev &
sleep 3
curl -s http://localhost:4001/.well-known/openid-configuration | jq '.issuer, .authorization_endpoint'
# Expected: "http://localhost:4001", "http://localhost:4001/oauth/authorize" (no double slash)
pkill -f "nest start"

# Verify openid-client v5 can discover (when packages/security AUTH-09 ready)
# node -e "
# const { Issuer } = require('openid-client');
# (async () => {
#   const issuer = await Issuer.discover('http://localhost:4001/.well-known/openid-configuration');
#   console.log(issuer.metadata);
# })();
# "

# Run tests
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock test

# Run only discovery spec
cd /home/z/my-project/retry-failure/apps/auth-mock && pnpm test discovery.controller.spec.ts

# Typecheck + lint
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock typecheck
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock lint
```

## Notes

- **Discovery document** per OIDC Discovery 1.0 spec (RFC 8414 — OAuth 2.0 Authorization Server Metadata, mirip). Field names snake_case.
- **`issuer` field** WAJIB match JWT `iss` claim. Verifier di payment-api akan bandingkan (plan2 section 5.2).
- **`userinfo_endpoint`** di-list meski `/oauth/userinfo` belum diimplement (plan2 section 10.1 mention opsional). Bila ingin lebih ketat, hapus field ini. Untuk plan2, dipertahankan supaya discovery lengkap (tidak semua client pakai userinfo).
- **`Cache-Control: max-age=3600`** — discovery jarang berubah, boleh cache 1 jam. Bandingkan dengan JWKS yang cache 5 menit (`max-age=300` di AUTH-02).
- **Auth-mock = referensi** untuk auth asli. Saat auth asli implement OAuth2 (plan2 section 25), discovery document di auth asli harus match field-by-field dengan auth-mock supaya `openid-client` v5 di payment-api bisa bekerja dengan keduanya tanpa code change.
- **Plan2 section 15.4** — discovery mengurangi env di payment-api. Setelah discovery jalan, env payment-api bisa dipangkas menjadi:
  ```
  AUTH_ISSUER=http://localhost:4001
  JWT_AUDIENCE=payment-api
  OAUTH_CLIENT_ID=payment-api
  OAUTH_CLIENT_SECRET=dev-client-secret
  OAUTH_REDIRECT_URI=http://localhost:3001/auth/callback
  ```
  (`AUTH_BASE_URL` tidak perlu lagi — `openid-client` discover dari `AUTH_ISSUER`.)
- Setelah task ini selesai, AUTH-08 (scaffold packages/security) bisa mulai. Auth-mock sudah lengkap (scaffold + JWKS + OAuth2 endpoints + UI + internal endpoints + fixtures + discovery).
