# AUTH-01 — Scaffold `apps/auth-mock` (NestJS + EJS + package.json)

> **Task ID**: AUTH-01
> **Plan**: Plan 2 — Auth Integration (v1.2.2)
> **Depends on**: -
> **Estimated effort**: S (~45 min)
> **Plan reference**: Section 10 (apps/auth-mock OAuth2 reference), Section 2.3 (auth-mock stack), Section 10.7.1 (folder structure), Section 10.7.2 (main.ts bootstrap)

---

## Goal

Menyiapkan `apps/auth-mock` sebagai NestJS app kosong di port `4001` dengan struktur folder lengkap sesuai plan2 (modules/oauth + modules/user + modules/client + views + public). App ini adalah shell yang akan diisi oleh AUTH-02 (JWKS), AUTH-03 (OAuth2 endpoints), AUTH-04 (login UI), AUTH-05 (internal endpoints), AUTH-06 (fixtures), AUTH-07 (OIDC discovery).

## Scope

**In scope**:
- Buat `apps/auth-mock/` di monorepo retry-failure (`pnpm-workspace.yaml` sudah include `apps/*`).
- `package.json` dengan dependencies sesuai plan2 section 2.3 (NestJS 11, ejs, jose v5, uuid, class-validator, @nestjs/throttler, ioredis + lru-cache opsional).
- `tsconfig.json`, `nest-cli.json`, `eslint.config.mjs`, `jest.config.js`.
- `src/main.ts` bootstrap `NestExpressApplication` dengan `useStaticAssets` + `setBaseViewsDir` + `setViewEngine('ejs')` + listen port `4001`.
- `src/app.module.ts` empty root module (import sub-module akan diisi task berikutnya).
- `src/modules/oauth/oauth.module.ts` (empty placeholder).
- `src/modules/user/user.module.ts` (empty placeholder).
- `src/modules/client/client.module.ts` (empty placeholder).
- `views/` folder dengan `.gitkeep`.
- `public/` folder dengan `.gitkeep`.
- Update root `package.json` scripts (sudah ada, tapi pastikan `dev:auth-mock` filter ada).
- Update `.env.example` + `.env.sandbox.example` dengan `AUTH_MOCK_PORT=4001` (opsional, default 4001).

**Out of scope**:
- OAuth2 endpoints (`/oauth/authorize`, `/oauth/token`, `/oauth/revoke`) → AUTH-03.
- Login UI (EJS templates) → AUTH-04.
- JWKS endpoint → AUTH-02.
- Fixture users/roles/permissions → AUTH-06.
- Internal endpoints (`/api/v1/me/permissions`, dst.) → AUTH-05.
- OIDC discovery → AUTH-07.
- Dockerfile → akan dibuat terpisah (lihat section 10.8 plan).

## Files to create/modify

- `apps/auth-mock/package.json`
- `apps/auth-mock/tsconfig.json`
- `apps/auth-mock/tsconfig.build.json`
- `apps/auth-mock/nest-cli.json`
- `apps/auth-mock/eslint.config.mjs`
- `apps/auth-mock/jest.config.js`
- `apps/auth-mock/src/main.ts`
- `apps/auth-mock/src/app.module.ts`
- `apps/auth-mock/src/modules/oauth/oauth.module.ts` — empty placeholder
- `apps/auth-mock/src/modules/oauth/oauth.controller.ts` — stub health route
- `apps/auth-mock/src/modules/oauth/oauth.service.ts` — empty
- `apps/auth-mock/src/modules/user/user.module.ts` — empty placeholder
- `apps/auth-mock/src/modules/user/user.service.ts` — empty
- `apps/auth-mock/src/modules/client/client.module.ts` — empty placeholder
- `apps/auth-mock/src/modules/client/client.service.ts` — empty
- `apps/auth-mock/views/.gitkeep`
- `apps/auth-mock/public/.gitkeep`
- `apps/auth-mock/README.md` — short overview (1 paragraf)
- `.env.example` (modify, add `AUTH_MOCK_PORT=4001` jika belum)
- `.env.sandbox.example` (modify, add `AUTH_MOCK_PORT=4001`)

## Implementation steps

1. Buat folder structure:
   ```bash
   cd /home/z/my-project/retry-failure
   mkdir -p apps/auth-mock/src/modules/oauth
   mkdir -p apps/auth-mock/src/modules/user
   mkdir -p apps/auth-mock/src/modules/client
   mkdir -p apps/auth-mock/views
   mkdir -p apps/auth-mock/public
   mkdir -p apps/auth-mock/test
   touch apps/auth-mock/views/.gitkeep apps/auth-mock/public/.gitkeep
   ```

2. Buat `apps/auth-mock/package.json`:
   ```json
   {
     "name": "auth-mock",
     "version": "0.1.0",
     "private": true,
     "description": "OAuth2 reference implementation for Plan 2 — Auth Integration",
     "scripts": {
       "start:dev": "nest start --watch",
       "start": "node dist/main.js",
       "build": "nest build",
       "lint": "eslint src --ext .ts",
       "typecheck": "tsc --noEmit",
       "test": "jest",
       "test:e2e": "jest --config ./test/jest-e2e.json"
     },
     "dependencies": {
       "@nestjs/common": "^11.0.0",
       "@nestjs/core": "^11.0.0",
       "@nestjs/platform-express": "^11.0.0",
       "@nestjs/throttler": "^6.0.0",
       "class-transformer": "^0.5.1",
       "class-validator": "^0.14.1",
       "cookie-parser": "^1.4.7",
       "ejs": "^3.1.10",
       "jose": "^5.9.0",
       "reflect-metadata": "^0.2.2",
       "rxjs": "^7.8.1",
       "uuid": "^10.0.0"
     },
     "devDependencies": {
       "@nestjs/cli": "^11.0.0",
       "@nestjs/testing": "^11.0.0",
       "@types/express": "^4.17.21",
       "@types/jest": "^29.5.0",
       "@types/node": "^20.14.0",
       "@types/supertest": "^6.0.0",
       "@types/uuid": "^10.0.0",
       "jest": "^29.7.0",
       "supertest": "^7.0.0",
       "ts-jest": "^29.2.0",
       "ts-node": "^10.9.0",
       "typescript": "^5.6.0"
     }
   }
   ```

3. Buat `apps/auth-mock/tsconfig.json`:
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

4. Buat `apps/auth-mock/tsconfig.build.json`:
   ```json
   {
     "extends": "./tsconfig.json",
     "exclude": ["node_modules", "test", "dist", "**/*spec.ts", "**/*.e2e-spec.ts"]
   }
   ```

5. Buat `apps/auth-mock/nest-cli.json`:
   ```json
   {
     "$schema": "https://json.schemastore.org/nest-cli",
     "collection": "@nestjs/schematics",
     "sourceRoot": "src",
     "compilerOptions": {
       "deleteOutDir": true,
       "assets": [
         { "include": "../views/**/*", "outDir": "dist/views" },
         { "include": "../public/**/*", "outDir": "dist/public" }
       ]
     }
   }
   ```

6. Buat `apps/auth-mock/eslint.config.mjs` (copy dari `apps/payment-gateway-mock/eslint.config.mjs`, sesuaikan jika perlu).

7. Buat `apps/auth-mock/jest.config.js`:
   ```js
   module.exports = {
     moduleFileExtensions: ['js', 'json', 'ts'],
     rootDir: 'src',
     testRegex: '.*\\.spec\\.ts$',
     transform: { '^.+\\.ts$': 'ts-jest' },
     collectCoverageFrom: ['**/*.ts'],
     coverageDirectory: '../coverage',
     testEnvironment: 'node',
   };
   ```

8. Buat `apps/auth-mock/src/main.ts` — bootstrap NestExpressApplication (sesuai plan2 section 10.7.2):
   ```ts
   import { NestFactory } from '@nestjs/core';
   import { NestExpressApplication } from '@nestjs/platform-express';
   import { join } from 'node:path';
   import { Logger } from '@nestjs/common';
   import { AppModule } from './app.module';

   async function bootstrap() {
     const app = await NestFactory.create<NestExpressApplication>(AppModule, {
       rawBody: true,
     });

     // Static assets (CSS, JS, images) — /style.css, etc.
     app.useStaticAssets(join(__dirname, '..', 'public'));

     // Views directory (EJS templates) — login.ejs, select-role.ejs, error.ejs
     app.setBaseViewsDir(join(__dirname, '..', 'views'));
     app.setViewEngine('ejs');

     // cookie-parser (akan dipakai untuk auth_sid session)
     const cookieParser = await import('cookie-parser');
     app.use(cookieParser.default());

     const port = Number(process.env.AUTH_MOCK_PORT ?? 4001);
     await app.listen(port);

     const logger = new Logger('AuthMock');
     logger.log(`auth-mock listening on http://localhost:${port}`);
     logger.log('⚠️  Development only — do NOT use in production.');
   }

   bootstrap();
   ```

9. Buat `apps/auth-mock/src/app.module.ts`:
   ```ts
   import { Module } from '@nestjs/common';
   import { OAuthModule } from './modules/oauth/oauth.module';
   import { UserModule } from './modules/user/user.module';
   import { ClientModule } from './modules/client/client.module';

   @Module({
     imports: [OAuthModule, UserModule, ClientModule],
   })
   export class AppModule {}
   ```

10. Buat placeholder modules + services + controllers (stub). OAuthController hanya punya `GET /health`:
    ```ts
    // src/modules/oauth/oauth.controller.ts
    import { Controller, Get } from '@nestjs/common';

    @Controller()
    export class OAuthController {
      @Get('health')
      health() {
        return { status: 'ok', service: 'auth-mock', version: '0.1.0' };
      }
    }
    ```

11. Update `.env.example` (di root monorepo) — append:
    ```env
    # Auth Mock (apps/auth-mock)
    AUTH_MOCK_PORT=4001
    ```

12. Update `.env.sandbox.example` — append `AUTH_MOCK_PORT=4001`.

13. Run `pnpm install` di root untuk install dependencies auth-mock.

14. Run `pnpm --filter auth-mock typecheck` + `pnpm --filter auth-mock lint` untuk verifikasi.

## Acceptance criteria

- [ ] `apps/auth-mock/` folder ada dengan struktur sesuai scope.
- [ ] `pnpm install` di root selesai tanpa error.
- [ ] `pnpm --filter auth-mock start:dev` bisa start NestJS di port 4001.
- [ ] `curl http://localhost:4001/health` mengembalikan `{ "status": "ok", "service": "auth-mock", "version": "0.1.0" }`.
- [ ] `pnpm --filter auth-mock typecheck` lulus.
- [ ] `pnpm --filter auth-mock lint` lulus.
- [ ] Struktur folder `views/` + `public/` ada (meskipun kosong, .gitkeep).
- [ ] `tsconfig.json` extends `../../tsconfig.base.json`.
- [ ] `.env.example` + `.env.sandbox.example` punya `AUTH_MOCK_PORT=4001`.

## Useful commands

```bash
# Install dependencies (root)
cd /home/z/my-project/retry-failure && pnpm install

# Run auth-mock dev server (port 4001)
cd /home/z/my-project/retry-failure/apps/auth-mock && pnpm start:dev
# atau via workspace filter:
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock start:dev

# Verify health endpoint
curl -s http://localhost:4001/health
# Expected: {"status":"ok","service":"auth-mock","version":"0.1.0"}

# Typecheck
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock typecheck

# Lint
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock lint

# Test (placeholder — belum ada spec test)
cd /home/z/my-project/retry-failure && pnpm --filter auth-mock test

# Verify folder structure
ls -la /home/z/my-project/retry-failure/apps/auth-mock/
ls -la /home/z/my-project/retry-failure/apps/auth-mock/src/modules/

# Stop dev server
pkill -f "nest start" 2>/dev/null
```

## Notes

- **Port 4001** dipilih untuk auth-mock karena:
  - 3000 → sandbox preview
  - 3001 → payment-api (per fix v1.2.2)
  - 3002 → gateway-mock (sandbox)
  - 4001 → auth-mock (range berbeda, hindari konflik dengan service plan1).
- **EJS** dipilih bukan Vue untuk login UI (lihat plan2 section 10.7.10 "Kenapa HTML, bukan Vue"):
  - Sederhana, tidak butuh build step FE.
  - Mock = referensi alur, bukan produk.
  - Auth asli nanti bisa pakai Vue/Next.js.
- **NestExpressApplication** (bukan Fastify) karena EJS template engine lebih mudah di Express.
- Setelah task ini selesai, AUTH-02 bisa mulai (JWKS + RS256 keypair).
