# AUTH-02 — auth-mock RS256 keypair + JWKS endpoint

> **Task ID**: AUTH-02
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: AUTH-01
> **Estimated effort**: M (~90 min)
> **Plan reference**: Section 5.1 (Signing — RS256, JWKS, kid), Section 10.3 (Signing — keypair dev), Section 2.3 (jose v5 stack), Section 9.1 (OAUTH_PATHS.jwks), Section 25.3.A (migrasi HS256 → RS256)

---

## Goal

Generate dev RSA 2048 keypair (RS256) di `apps/auth-mock`, expose `/.well-known/jwks.json` endpoint dengan `kid` support, dan sediakan `KeyPairService` untuk sign/verify JWT via `jose` v5. Ini foundation untuk AUTH-03 (OAuth2 endpoints) dan AUTH-07 (OIDC discovery).

## Scope

**In scope**:
- Generate dev keypair RSA 2048 (private + public), disimpan di `apps/auth-mock/keys/` (gitignored, auto-generated saat first start).
- `KeyPairService` (singleton) yang load keypair di `OnModuleInit`:
  - Baca dari file `keys/dev-private.pem` + `keys/dev-public.pem` jika ada.
  - Auto-generate keypair baru + write ke file jika belum ada.
  - Compute `kid` (SHA-256 thumbprint dari public JWK per RFC 7638).
- `JwksController` dengan `GET /.well-known/jwks.json`:
  - Return `{ keys: [{ kty: 'RSA', kid, use: 'sig', alg: 'RS256', n, e }] }`.
- `KeyPairModule` untuk export `KeyPairService`.
- `keys/.gitignore` (ignore *.pem, allow .gitkeep + README.md).
- `keys/README.md` (penjelasan: auto-generated, dev only).
- Sign helper: `signJwt(claims, options)` → mengembalikan compact JWT RS256 dengan `kid` di header.
- Verify helper: `verifyJwt(token, expectedAudience)` → return payload atau throw.

**Out of scope**:
- OAuth2 endpoints (`/oauth/authorize`, `/oauth/token`, `/oauth/revoke`) → AUTH-03.
- Login UI → AUTH-04.
- Internal endpoints → AUTH-05.
- Fixtures (users/roles) → AUTH-06.
- OIDC discovery (`/.well-known/openid-configuration`) → AUTH-07 (perlu endpoints dulu).
- Key rotation (dual-key period) → production concern, ditunda (lihat plan2 section 21.2).
- Encryption at rest untuk private key → dev fixture, jangan over-engineer.

## Files to create/modify

- `apps/auth-mock/keys/.gitignore` — `*.pem`, allow `.gitkeep` + `README.md`
- `apps/auth-mock/keys/README.md` — penjelasan auto-generated dev keys
- `apps/auth-mock/keys/.gitkeep`
- `apps/auth-mock/src/modules/keypair/keypair.module.ts`
- `apps/auth-mock/src/modules/keypair/key-pair.service.ts` — load/generate, kid thumbprint
- `apps/auth-mock/src/modules/keypair/jwks.controller.ts` — `GET /.well-known/jwks.json`
- `apps/auth-mock/src/modules/keypair/jwt-signer.service.ts` — `signJwt` + `verifyJwt` helpers
- `apps/auth-mock/src/modules/keypair/index.ts` — barrel
- `apps/auth-mock/src/app.module.ts` — import `KeyPairModule`
- `apps/auth-mock/test/keypair.spec.ts` — unit test sign/verify roundtrip
- `apps/auth-mock/test/jwks.controller.spec.ts` — integration test JWKS endpoint

## Implementation steps

1. Buat folder `apps/auth-mock/keys/` + `.gitignore` + `README.md` + `.gitkeep`.

2. Buat `KeyPairService` (`apps/auth-mock/src/modules/keypair/key-pair.service.ts`):
   ```ts
   import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
   import { importSPKI, importPKCS8, exportJWK, calculateJwkThumbprint } from 'jose';
   import { generateKeyPairSync } from 'node:crypto';
   import { readFile, writeFile, mkdir } from 'node:fs/promises';
   import { existsSync } from 'node:fs';
   import { join } from 'node:path';

   interface LoadedKeyPair {
     privateKey: CryptoKey;
     publicKey: CryptoKey;
     publicJwk: { kty: 'RSA'; kid: string; use: 'sig'; alg: 'RS256'; n: string; e: string };
     kid: string;
   }

   @Injectable()
   export class KeyPairService implements OnModuleInit {
     private readonly logger = new Logger('KeyPairService');
     private readonly keysDir = join(__dirname, '..', '..', '..', 'keys');
     private readonly privateKeyPath = join(this.keysDir, 'dev-private.pem');
     private readonly publicKeyPath = join(this.keysDir, 'dev-public.pem');
     private loaded!: LoadedKeyPair;

     async onModuleInit(): Promise<void> {
       this.loaded = await this.loadOrCreate();
       this.logger.log(`Loaded keypair kid=${this.loaded.kid}`);
     }

     get privateKey(): CryptoKey { return this.loaded.privateKey; }
     get publicKey(): CryptoKey { return this.loaded.publicKey; }
     get kid(): string { return this.loaded.kid; }
     get publicJwk() { return this.loaded.publicJwk; }

     private async loadOrCreate(): Promise<LoadedKeyPair> {
       if (existsSync(this.privateKeyPath) && existsSync(this.publicKeyPath)) {
         const privPem = await readFile(this.privateKeyPath, 'utf8');
         const pubPem = await readFile(this.publicKeyPath, 'utf8');
         const privateKey = await importPKCS8(privPem, 'RS256');
         const publicKey = await importSPKI(pubPem, 'RS256');
         return await this.asLoaded(publicKey, privateKey);
       }

       this.logger.warn('Keypair not found — generating new RSA 2048 keypair (dev only).');
       if (!existsSync(this.keysDir)) await mkdir(this.keysDir, { recursive: true });

       const { privateKey, publicKey } = generateKeyPairSync('rsa', {
         modulusLength: 2048,
         publicKeyEncoding: { type: 'spki', format: 'pem' },
         privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
       });

       await writeFile(this.privateKeyPath, privateKey, { mode: 0o600 });
       await writeFile(this.publicKeyPath, publicKey, { mode: 0o644 });

       const importedPriv = await importPKCS8(privateKey as string, 'RS256');
       const importedPub = await importSPKI(publicKey as string, 'RS256');
       return await this.asLoaded(importedPub, importedPriv);
     }

     private async asLoaded(publicKey: CryptoKey, privateKey: CryptoKey): Promise<LoadedKeyPair> {
       const jwk = await exportJWK(publicKey);
       const kid = await calculateJwkThumbprint(jwk);
       const publicJwk = {
         kty: 'RSA' as const,
         kid,
         use: 'sig' as const,
         alg: 'RS256' as const,
         n: jwk.n!,
         e: jwk.e!,
       };
       return { privateKey, publicKey, publicJwk, kid };
     }
   }
   ```

3. Buat `JwtSignerService` (`apps/auth-mock/src/modules/keypair/jwt-signer.service.ts`):
   ```ts
   import { Injectable } from '@nestjs/common';
   import { SignJWT, jwtVerify, JWTPayload } from 'jose';
   import { KeyPairService } from './key-pair.service';

   export interface SignOptions {
     issuer: string;
     audience: string;
     expiresIn: string; // e.g. '15m', '8h'
     jti?: string;
   }

   @Injectable()
   export class JwtSignerService {
     constructor(private readonly keyPair: KeyPairService) {}

     async sign(claims: Record<string, unknown>, options: SignOptions): Promise<string> {
       return await new SignJWT({ ...claims })
         .setProtectedHeader({ alg: 'RS256', kid: this.keyPair.kid, typ: 'JWT' })
         .setIssuedAt()
         .setIssuer(options.issuer)
         .setAudience(options.audience)
         .setExpirationTime(options.expiresIn)
         .setJti(options.jti ?? crypto.randomUUID())
         .sign(this.keyPair.privateKey);
     }

     async verify(token: string, expectedAudience: string, expectedIssuer: string): Promise<JWTPayload> {
       const { payload } = await jwtVerify(token, this.keyPair.publicKey, {
         algorithms: ['RS256'],
         audience: expectedAudience,
         issuer: expectedIssuer,
         clockTolerance: 5,
       });
       return payload;
     }
   }
   ```

4. Buat `JwksController` (`apps/auth-mock/src/modules/keypair/jwks.controller.ts`):
   ```ts
   import { Controller, Get, Header, HttpStatus } from '@nestjs/common';
   import { KeyPairService } from './key-pair.service';

   @Controller()
   export class JwksController {
     constructor(private readonly keyPair: KeyPairService) {}

     @Get('.well-known/jwks.json')
     @Header('Cache-Control', 'public, max-age=300')
     @Header('Content-Type', 'application/json; charset=utf-8')
     jwks() {
       return { keys: [this.keyPair.publicJwk] };
     }
   }
   ```
   > Catatan: `Cache-Control: max-age=300` (5 menit) — verifier boleh cache 5 menit (plan2 env `JWKS_CACHE_TTL_SEC=300`).

5. Buat `KeyPairModule`:
   ```ts
   import { Module } from '@nestjs/common';
   import { KeyPairService } from './key-pair.service';
   import { JwtSignerService } from './jwt-signer.service';
   import { JwksController } from './jwks.controller';

   @Module({
     providers: [KeyPairService, JwtSignerService],
     controllers: [JwksController],
     exports: [KeyPairService, JwtSignerService],
   })
   export class KeyPairModule {}
   ```

6. Update `apps/auth-mock/src/app.module.ts` untuk import `KeyPairModule`.

7. Buat unit test `apps/auth-mock/test/keypair.spec.ts`:
   - Test sign + verify roundtrip (sign JWT lalu verify, payload sesuai).
   - Test invalid signature throw.
   - Test expired token throw (`expiresIn: '1s'` + sleep 1.5s).
   - Test `kid` ada di header JWT.

8. Buat integration test `apps/auth-mock/test/jwks.controller.spec.ts`:
   - Test `GET /.well-known/jwks.json` mengembalikan `{ keys: [{ kty: 'RSA', kid, use: 'sig', alg: 'RS256', n, e }] }`.
   - Test response `Cache-Control: max-age=300`.
   - Test `kid` konsisten antara JWT header + JWKS.

9. Run tests + manual verify:
   ```bash
   cd /home/z/my-project/retry-failure/apps/auth-mock && pnpm start:dev
   curl http://localhost:4001/.well-known/jwks.json | jq .
   ```

## Acceptance criteria

- [ ] `apps/auth-mock/keys/dev-private.pem` + `dev-public.pem` terbentuk otomatis saat pertama kali start (RSA 2048).
- [ ] `keys/.gitignore` mencegah commit file `.pem`.
- [ ] `GET /.well-known/jwks.json` mengembalikan JWK set valid (1 key, RS256).
- [ ] `kid` di JWK = SHA-256 thumbprint RFC 7638.
- [ ] `kid` di JWT header (setelah sign) cocok dengan `kid` di JWKS.
- [ ] `JwtSignerService.sign()` menghasilkan JWT RS256 valid (verifiable via `jose` di sisi payment-api).
- [ ] `JwtSignerService.verify()` me-reject token dengan:
  - signature salah,
  - audience tidak cocok,
  - issuer tidak cocok,
  - token expired,
  - algoritma bukan RS256.
- [ ] `clockTolerance: 5` detik di-configure.
- [ ] Unit test (`keypair.spec.ts`) + integration test (`jwks.controller.spec.ts`) lulus.
- [ ] `pnpm --filter auth-mock typecheck` lulus.
- [ ] `pnpm --filter auth-mock lint` lulus.

## Useful commands

```bash
# Start auth-mock + test JWKS endpoint
cd /home/z/my-project/retry-failure/apps/auth-mock && pnpm start:dev
curl -s http://localhost:4001/.well-known/jwks.json | jq .

# Verify kid di JWKS
KID=$(curl -s http://localhost:4001/.well-known/jwks.json | jq -r '.keys[0].kid')
echo "kid: $KID"

# Decode JWT header (pakai sample JWT dari sign helper, paste token di sini)
echo "<token>" | cut -d. -f1 | base64 -d 2>/dev/null | jq .

# Run unit + integration tests
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock test

# Run specific test file
cd /home/z/my-project/retry-failure/apps/auth-mock && pnpm test keypair.spec.ts

# Inspect dev keys (should be RSA 2048)
openssl rsa -in apps/auth-mock/keys/dev-private.pem -text -noout | head -5
openssl rsa -in apps/auth-mock/keys/dev-public.pem -pubin -text -noout | head -5

# Typecheck + lint
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock typecheck
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock lint

# Cleanup dev keys (untuk test regenerate)
rm -f apps/auth-mock/keys/dev-*.pem
```

## Notes

- **jose v5** dipilih (bukan v6) untuk konsistensi dengan `packages/security` (plan2 section 2.3).
- **RSA 2048** cukup untuk dev. Untuk production, EC P-256 lebih ringan (plan2 section 25.3.A). Migrasi dilakukan di auth asli, bukan mock.
- **kid thumbprint** RFC 7638 → `calculateJwkThumbprint(jwk)` dari `jose`. Stable identifier untuk key rotation nanti.
- **Cache-Control: max-age=300** — payment-api JWKS verifier boleh cache 5 menit (env `JWKS_CACHE_TTL_SEC=300`).
- **Mode 0o600** untuk private key — hanya owner bisa read. Mode 0o644 untuk public key (memang harus public).
- **Auto-generate di onModuleInit**: lebih developer-friendly daripada script terpisah. Saat first `pnpm start:dev`, keypair otomatis dibuat.
- Setelah task ini selesai, AUTH-03 (OAuth2 endpoints) bisa mulai pakai `JwtSignerService` untuk sign access + refresh token.
