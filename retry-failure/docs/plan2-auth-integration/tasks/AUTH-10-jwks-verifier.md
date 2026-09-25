# AUTH-10 — security — JWKS verifier (jose v5 + createRemoteJWKSet + cache)

> **Task ID**: AUTH-10
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-08
> **Estimated effort**: M (~2 jam)
> **Plan reference**: Section 5.1 (Signing — RS256, JWKS, kid), Section 2.3 (jose v5 stack), Section 9 (verifiers/jwks-verifier.ts), Section 16 (env `JWT_CLOCK_TOLERANCE_SEC=5`, `JWKS_CACHE_TTL_SEC=300`), Section 21.2 (key rotation), Section 9.3 (AUTH_MODE)

---

## Goal

Implementasi `JwksVerifier` di `packages/security` yang verify JWT RS256 via JWKS public keys (fetched dari auth `/.well-known/jwks.json`) menggunakan `jose` v5 `createRemoteJWKSet` + cache. Support `kid` rotation, clock tolerance, dan provide `MockVerifier` alternatif untuk `AUTH_MODE=mock` (verify against auth-mock JWKS).

## Scope

**In scope**:
- `JwksVerifier` (`packages/security/src/verifiers/jwks-verifier.ts`):
  - Constructor menerima `jwksUri` (auth `/.well-known/jwks.json`), `expectedIssuer`, `expectedAudience`, `clockToleranceSec` (default 5), `cacheTtlSec` (default 300).
  - `verify(token)`:
    - Pakai `createRemoteJWKSet(new URL(jwksUri))` (jose v5, auto-cache + auto-refresh).
    - `jwtVerify(token, key, { algorithms: ['RS256'], issuer, audience, clockTolerance })`.
    - Return `JWTPayload` (sub, username, roleId, iss, aud, exp, iat, jti).
  - `verifyAuthUser(token)`:
    - Verify token + map payload → `AuthUser` (dari plan2 section 9.2).
    - Return `AuthUser` dengan `userId`, `username`, `roleId` dari JWT.
    - **Note**: `isSuperAdmin` + `permissionCodes` TIDAK dari JWT (JWT tipis) — diisi dari session/cache. Caller wajib merge.
- `MockVerifier` (`packages/security/src/verifiers/mock-verifier.ts`):
  - Sama interface dengan `JwksVerifier`.
  - Hanya beda: `jwksUri` default ke `auth-mock` `/.well-known/jwks.json` (`http://localhost:4001/.well-known/jwks.json`).
  - Dipakai saat `AUTH_MODE=mock` (bisa juga pakai `JwksVerifier` langsung — MockVerifier hanya convenience alias).
- `JwtVerifierInterface` (opsional, untuk DI swap berdasarkan `AUTH_MODE`).
- Cache: `createRemoteJWKSet` dari jose sudah handle cache internal (cooldown 30s default + max-age dari Cache-Control header auth).
- kid rotation: jose auto-fetch ulang bila `kid` di header JWT tidak ada di cached JWKS.
- Unit test: mock `fetch` (nock) untuk JWKS endpoint + verify JWT sign + verify dengan private key.

**Out of scope**:
- `AUTH_MODE=disabled` user palsu → AUTH-13 (SessionGuard handle).
- Token introspection (RFC 7662) → tidak, plan2 tidak pakai.
- Encrypted JWT (JWE) → tidak, hanya sign (JWS).
- Key rotation UI → tidak (manual rotation via auth service).

## Files to create/modify

- `packages/security/src/verifiers/jwks-verifier.ts` — full implementation
- `packages/security/src/verifiers/mock-verifier.ts` — full implementation (subclass of JwksVerifier)
- `packages/security/src/verifiers/jwt-verifier.interface.ts` — `JwtVerifier` interface (untuk DI swap)
- `packages/security/src/verifiers/index.ts` — barrel
- `packages/security/src/security.module.ts` — provide JwksVerifier / MockVerifier based on `AUTH_MODE`
- `packages/security/test/jwks-verifier.spec.ts` — unit test dengan jose keypair + nock
- `packages/security/test/mock-verifier.spec.ts` — verify MockVerifier bekerja sama (subclass)

## Implementation steps

1. **`jwt-verifier.interface.ts`**:
   ```ts
   import { JWTPayload } from 'jose';
   import { AuthUser } from '../types/auth-user';

   export interface JwtVerifier {
     verify(token: string): Promise<JWTPayload>;
     verifyAuthUser(token: string): Promise<{ userId: string; username: string; roleId: string }>;
   }
   ```

2. **`jwks-verifier.ts`**:
   ```ts
   import { Injectable, Inject, Logger } from '@nestjs/common';
   import { createRemoteJWKSet, jwtVerify, JWTPayload, errors as joseErrors } from 'jose';
   import { JwtVerifier } from './jwt-verifier.interface';
   import { SecurityOptions } from '../security.types';

   @Injectable()
   export class JwksVerifier implements JwtVerifier {
     private readonly logger = new Logger('JwksVerifier');
     private readonly remoteJwks: ReturnType<typeof createRemoteJWKSet>;
     private readonly issuer: string;
     private readonly audience: string;
     private readonly clockToleranceSec: number;

     constructor(@Inject('SECURITY_OPTIONS') opts: SecurityOptions) {
       const jwksUri = `${opts.authIssuer.replace(/\/+$/, '')}/.well-known/jwks.json`;
       this.remoteJwks = createRemoteJWKSet(new URL(jwksUri), {
         cooldownDuration: 30_000, // 30s — minimum interval between fetches
         cacheMaxAge: (opts.jwksCacheTtlSec ?? 300) * 1000,
       });
       this.issuer = opts.authIssuer;
       this.audience = opts.jwtAudience;
       this.clockToleranceSec = opts.jwtClockToleranceSec ?? 5;
       this.logger.log(`Initialized JWKS verifier: jwksUri=${jwksUri}, iss=${this.issuer}, aud=${this.audience}, clockTolerance=${this.clockToleranceSec}s`);
     }

     async verify(token: string): Promise<JWTPayload> {
       try {
         const { payload } = await jwtVerify(token, this.remoteJwks, {
           algorithms: ['RS256'],
           issuer: this.issuer,
           audience: this.audience,
           clockTolerance: this.clockToleranceSec,
         });
         return payload;
       } catch (err) {
         if (err instanceof joseErrors.JWSSignatureVerificationFailed) {
           throw new Error('JWT signature invalid');
         }
         if (err instanceof joseErrors.JWTExpired) {
           throw new Error('JWT expired');
         }
         if (err instanceof joseErrors.JWTClaimValidationFailed) {
           throw new Error(`JWT claim invalid: ${err.message}`);
         }
         if (err instanceof joseErrors.JWKSTimeout || err instanceof joseErrors.JWKSNoMatchingKey) {
           throw new Error(`JWKS fetch failed: ${err.message}`);
         }
         throw err;
       }
     }

     async verifyAuthUser(token: string): Promise<{ userId: string; username: string; roleId: string }> {
       const payload = await this.verify(token);
       if (!payload.sub || !payload.username || !payload.roleId) {
         throw new Error('JWT missing required claims (sub, username, roleId)');
       }
       return {
         userId: payload.sub,
         username: payload.username as string,
         roleId: payload.roleId as string,
       };
     }
   }
   ```
   > Catatan: `payload.username` + `payload.roleId` adalah custom claims (bukan registered JWT claims). Cast ke string.

3. **`mock-verifier.ts`** (subclass yang sama, hanya beda konfigurasi):
   ```ts
   import { Injectable } from '@nestjs/common';
   import { JwksVerifier } from './jwks-verifier';

   @Injectable()
   export class MockVerifier extends JwksVerifier {
     // Konfigurasi (authIssuer, dll) sudah benar karena SecurityOptions.authIssuer = http://localhost:4001
     // saat AUTH_MODE=mock. Tidak perlu override logic.
   }
   ```

4. **`security.module.ts`** — update provider factory berdasarkan `AUTH_MODE`:
   ```ts
   const verifierProvider = {
     provide: 'JWT_VERIFIER',
     useFactory: (opts: SecurityOptions) => {
       if (opts.authMode === 'mock') return new MockVerifier(opts);
       return new JwksVerifier(opts);
     },
     inject: ['SECURITY_OPTIONS'],
   };
   ```

5. **Update `index.ts`** barrel — export `JwtVerifier` interface + kedua class.

6. **Unit test** (`packages/security/test/jwks-verifier.spec.ts`):
   ```ts
   import { generateKeyPairSync, SignJWT } from 'jose';
   import { createHash } from 'node:crypto';
   import nock from 'nock';
   import { JwksVerifier } from '../src/verifiers/jwks-verifier';

   describe('JwksVerifier', () => {
     let verifier: JwksVerifier;
     let privateKey: any;
     let publicKey: any;
     let kid: string;

     beforeAll(async () => {
       // Generate test keypair
       const kp = await generateKeyPair('RS256', { modulusLength: 2048 });
       privateKey = kp.privateKey;
       publicKey = kp.publicKey;

       // Compute kid (RFC 7638 thumbprint)
       const jwk = await exportJWK(publicKey);
       kid = await calculateJwkThumbprint(jwk);

       // Build JWKS response
       const jwksResponse = {
         keys: [{
           kty: 'RSA', kid, use: 'sig', alg: 'RS256',
           n: jwk.n, e: jwk.e,
         }],
       };

       // Nock JWKS endpoint
       nock('http://localhost:4001')
         .persist()
         .get('/.well-known/jwks.json')
         .reply(200, jwksResponse, { 'Cache-Control': 'max-age=300' });
     });

     beforeEach(() => {
       verifier = new JwksVerifier({
         authMode: 'oauth',
         authIssuer: 'http://localhost:4001',
         authBaseUrl: 'http://localhost:4001',
         jwtAudience: 'payment-api',
         oauthClientId: 'payment-api',
         oauthClientSecret: 'x',
         oauthRedirectUri: 'http://localhost:3001/auth/callback',
         oauthScopes: ['openid'],
         sessionStore: 'memory',
         jwtClockToleranceSec: 5,
         jwksCacheTtlSec: 300,
       });
     });

     it('verifies valid RS256 JWT signed by auth-mock keypair', async () => {
       const token = await new SignJWT({ username: 'budi', roleId: 'r-1' })
         .setProtectedHeader({ alg: 'RS256', kid, typ: 'JWT' })
         .setIssuer('http://localhost:4001')
         .setAudience('payment-api')
         .setIssuedAt()
         .setExpirationTime('15m')
         .setSubject('user-1')
         .setJti('test-jti')
         .sign(privateKey);

       const payload = await verifier.verify(token);
       expect(payload.sub).toBe('user-1');
       expect(payload.username).toBe('budi');
       expect(payload.roleId).toBe('r-1');
     });

     it('verifiesAuthUser returns {userId, username, roleId}', async () => {
       const token = await new SignJWT({ username: 'admin', roleId: 'r-2' })
         .setProtectedHeader({ alg: 'RS256', kid })
         .setIssuer('http://localhost:4001').setAudience('payment-api')
         .setIssuedAt().setExpirationTime('15m')
         .setSubject('user-2')
         .sign(privateKey);

       const user = await verifier.verifyAuthUser(token);
       expect(user).toEqual({ userId: 'user-2', username: 'admin', roleId: 'r-2' });
     });

     it('rejects token with wrong issuer', async () => {
       const token = await new SignJWT({})
         .setProtectedHeader({ alg: 'RS256', kid })
         .setIssuer('https://wrong.com')
         .setAudience('payment-api')
         .setIssuedAt().setExpirationTime('15m').setSubject('user-1')
         .sign(privateKey);
       await expect(verifier.verify(token)).rejects.toThrow(/issuer/i);
     });

     it('rejects token with wrong audience', async () => {
       const token = await new SignJWT({})
         .setProtectedHeader({ alg: 'RS256', kid })
         .setIssuer('http://localhost:4001')
         .setAudience('other-api')
         .setIssuedAt().setExpirationTime('15m').setSubject('user-1')
         .sign(privateKey);
       await expect(verifier.verify(token)).rejects.toThrow(/audience/i);
     });

     it('rejects expired token', async () => {
       const token = await new SignJWT({})
         .setProtectedHeader({ alg: 'RS256', kid })
         .setIssuer('http://localhost:4001').setAudience('payment-api')
         .setIssuedAt().setExpirationTime('0s').setSubject('user-1')
         .sign(privateKey);
       await expect(verifier.verify(token)).rejects.toThrow(/expired/i);
     });

     it('rejects token with wrong signature (signed by different key)', async () => {
       const otherKp = await generateKeyPair('RS256', { modulusLength: 2048 });
       const token = await new SignJWT({})
         .setProtectedHeader({ alg: 'RS256', kid }) // but use same kid!
         .setIssuer('http://localhost:4001').setAudience('payment-api')
         .setIssuedAt().setExpirationTime('15m').setSubject('user-1')
         .sign(otherKp.privateKey); // signed by different key
       await expect(verifier.verify(token)).rejects.toThrow(/signature/i);
     });

     it('supports kid rotation (fetches new JWKS when kid not in cache)', async () => {
       // Generate new keypair + new kid
       const newKp = await generateKeyPair('RS256', { modulusLength: 2048 });
       const newJwk = await exportJWK(newKp.publicKey);
       const newKid = await calculateJwkThumbprint(newJwk);

       // Nock JWKS to return both keys now
       nock.cleanAll();
       nock('http://localhost:4001').persist().get('/.well-known/jwks.json').reply(200, {
         keys: [
           { kty: 'RSA', kid, use: 'sig', alg: 'RS256', n: jwk.n, e: jwk.e },
           { kty: 'RSA', kid: newKid, use: 'sig', alg: 'RS256', n: newJwk.n, e: newJwk.e },
         ],
       });

       const token = await new SignJWT({})
         .setProtectedHeader({ alg: 'RS256', kid: newKid })
         .setIssuer('http://localhost:4001').setAudience('payment-api')
         .setIssuedAt().setExpirationTime('15m').setSubject('user-1')
         .sign(newKp.privateKey);

       const payload = await verifier.verify(token);
       expect(payload.sub).toBe('user-1');
     });
   });
   ```

7. **Run tests**:
   ```bash
   cd  && pnpm --filter @retry-failure/security test
   ```

## Acceptance criteria

- [ ] `JwksVerifier.verify(token)` mengembalikan `JWTPayload` bila token valid RS256 + iss + aud cocok + belum expired.
- [ ] `JwksVerifier.verifyAuthUser(token)` mengembalikan `{ userId, username, roleId }` dari JWT claims.
- [ ] Reject token dengan: signature invalid, iss salah, aud salah, expired, kid tidak di JWKS.
- [ ] `clockTolerance: 5` detik di-configure (env `JWT_CLOCK_TOLERANCE_SEC=5`).
- [ ] `createRemoteJWKSet` cache dengan `cooldownDuration: 30_000` + `cacheMaxAge: 300_000` (5 menit, env `JWKS_CACHE_TTL_SEC=300`).
- [ ] kid rotation: bila `kid` di JWT header tidak ada di cached JWKS, jose auto-fetch ulang.
- [ ] `MockVerifier` adalah subclass `JwksVerifier` (sama logic, beda konfigurasi via SecurityOptions).
- [ ] `SecurityModule.forRoot` provide `JWT_VERIFIER` token: `MockVerifier` jika `AUTH_MODE=mock`, `JwksVerifier` untuk `oauth`.
- [ ] Unit test `jwks-verifier.spec.ts` lulus semua scenarios (valid, wrong iss, wrong aud, expired, wrong sig, kid rotation).
- [ ] `pnpm --filter @retry-failure/security typecheck` + `lint` lulus.

## Useful commands

```bash
# Typecheck
cd  && pnpm --filter @retry-failure/security typecheck

# Lint
cd  && pnpm --filter @retry-failure/security lint

# Run verifier tests
cd  && pnpm --filter @retry-failure/security test -- --testPathPattern=jwks-verifier

# Run all security tests
cd  && pnpm --filter @retry-failure/security test

# Integration test manual (butuh auth-mock running dengan AUTH-02 done)
# 1. Start auth-mock
cd /apps/auth-mock && pnpm start:dev &

# 2. Get dev token
TOKEN=$(curl -s -X POST http://localhost:4001/dev/token -H 'Content-Type: application/json' -d '{"username":"budi_santoso"}' | jq -r .accessToken)

# 3. Verify token via JWKS (script node)
node -e "
const { createRemoteJWKSet, jwtVerify } = require('jose');
(async () => {
  const jwks = createRemoteJWKSet(new URL('http://localhost:4001/.well-known/jwks.json'));
  const { payload } = await jwtVerify('$TOKEN', jwks, {
    algorithms: ['RS256'],
    issuer: 'http://localhost:4001',
    audience: 'payment-api',
    clockTolerance: 5,
  });
  console.log(JSON.stringify(payload, null, 2));
})().catch(e => { console.error('VERIFY FAILED:', e.message); process.exit(1); });
"

pkill -f "nest start"
```

## Notes

- **`createRemoteJWKSet`** dari `jose` v5 sudah handle:
  - HTTP fetch ke `jwksUri` (default: GET, expect JSON).
  - Cache in-memory (`cooldownDuration: 30s`, `cacheMaxAge: 300s`).
  - Auto-refetch bila `kid` di JWT header tidak ada di cache.
  - Honor `Cache-Control` header dari auth (plan2 AUTH-02 set `max-age=300`).
- **Clock tolerance** 5 detik — handle skenario clock drift antara auth server dan payment-api server. Default dari env `JWT_CLOCK_TOLERANCE_SEC=5` (plan2 section 16).
- **kid rotation** (plan2 section 21.2):
  - Auth service rotate keypair → publish JWKS dengan 2 keys (old kid + new kid).
  - Payment-api verifier fetch JWKS baru saat cooldown expired.
  - Token dengan old kid masih valid sampai auth hapus old kid dari JWKS.
  - Token dengan new kid di-verify dengan new public key.
- **`MockVerifier`** — plan2 section 9.3 menyebut AUTH_MODE=mock pakai auth-mock. Karena auth-mock juga punya JWKS endpoint (AUTH-02), `MockVerifier` tinggal pakai `JwksVerifier` dengan `authIssuer=http://localhost:4001`. Tidak ada logic beda. Subclass untuk clarity + kemudahan swap.
- **AuthUser mapping** — JWT tipis (plan2 section 5.2) hanya punya `sub` + `username` + `roleId`. `isSuperAdmin` + `permissionCodes` TIDAK dari JWT — diisi dari cache `cached_users` + `sessions`. Caller (SessionGuard di AUTH-13) wajib merge: `verifyAuthUser(token)` → lookup session by sid → merge JWT claims + session.permissionCodes.
- **Error mapping** — jose v5 throws typed errors (`JWSSignatureVerificationFailed`, `JWTExpired`, `JWTClaimValidationFailed`, `JWKSTimeout`, `JWKSNoMatchingKey`). Map ke message string agar caller tidak perlu import jose types.
- Setelah task ini selesai, AUTH-11 (SessionStore Redis + Memory) bisa mulai.
