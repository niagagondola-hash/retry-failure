# TASK-01 — Scaffolding: pnpm workspaces + NestJS monorepo + config

> **Task ID**: 1
> **Depends on**: —
> **Estimated effort**: S (~45 min)
> **Plan reference**: Section 3 (Stack), Section 4 (Struktur Monorepo), Section 15 (Configuration)

---

## Goal

Menyiapkan monorepo pnpm workspaces di `/home/z/my-project/retry-failure/` dengan struktur sesuai plan section 4, plus konfigurasi `@nestjs/config` + Joi schema validation. Fondasi untuk semua task berikutnya.

## Scope

**In scope**:
- Enable `pnpm` via corepack.
- Buat root files: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.env.example`, `.gitignore`.
- Scaffolding 3 NestJS apps (payment-api, payment-gateway-mock, frontend-vue — Vue app, bukan NestJS) + 1 package (`packages/resilience`).
- Shared config: `apps/payment-api/src/config/` dengan `@nestjs/config` + Joi.
- Common tsconfig extends.
- Root scripts: `dev`, `build`, `test`, `test:e2e`, `lint`, `db:migrate`, `docker:up`, `docker:down`, `frontend:vue:dev`, `frontend:vue:build`.
- Pin Node engine `>= 20` di root `package.json`.

**Out of scope**:
- Implementasi module NestJS apapun (di task berikutnya).
- Schema database (di TASK-02).
- Cockatiel policies (di TASK-05).
- Docker compose (di TASK-15 — minimal stub di sini).

## Files to create

- `/home/z/my-project/retry-failure/package.json`
- `/home/z/my-project/retry-failure/pnpm-workspace.yaml`
- `/home/z/my-project/retry-failure/tsconfig.base.json`
- `/home/z/my-project/retry-failure/.gitignore` — ignore `.env`, allow `.env.example` + `.env.sandbox.example`
- `/home/z/my-project/retry-failure/.env.example` — **KONDISI LOCAL** (port 3000, gateway 3001, Docker available)
- `/home/z/my-project/retry-failure/.env.sandbox.example` — **KONDISI SANDBOX** (port 3001, gateway 3002, no Docker)
- `/home/z/my-project/retry-failure/.nvmrc` — pin Node version
- `/home/z/my-project/retry-failure/apps/payment-api/package.json`
- `/home/z/my-project/retry-failure/apps/payment-api/tsconfig.json`
- `/home/z/my-project/retry-failure/apps/payment-api/nest-cli.json`
- `/home/z/my-project/retry-failure/apps/payment-api/src/main.ts` — minimal bootstrap
- `/home/z/my-project/retry-failure/apps/payment-api/src/app.module.ts` — empty root module
- `/home/z/my-project/retry-failure/apps/payment-api/src/config/config.module.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/config/configuration.ts`
- `/home/z/my-project/retry-failure/apps/payment-api/src/config/validation.schema.ts` — Joi
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/package.json`
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/tsconfig.json`
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/nest-cli.json`
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/main.ts`
- `/home/z/my-project/retry-failure/apps/payment-gateway-mock/src/app.module.ts`
- `/home/z/my-project/retry-failure/apps/frontend-vue/package.json` — Vite + Vue
- `/home/z/my-project/retry-failure/apps/frontend-vue/tsconfig.json`
- `/home/z/my-project/retry-failure/apps/frontend-vue/vite.config.ts`
- `/home/z/my-project/retry-failure/apps/frontend-vue/index.html`
- `/home/z/my-project/retry-failure/apps/frontend-vue/src/main.ts` — empty Vue bootstrap
- `/home/z/my-project/retry-failure/apps/frontend-vue/src/App.vue` — placeholder
- `/home/z/my-project/retry-failure/packages/resilience/package.json`
- `/home/z/my-project/retry-failure/packages/resilience/tsconfig.json`
- `/home/z/my-project/retry-failure/packages/resilience/src/index.ts` — barrel placeholder
- `/home/z/my-project/retry-failure/docker-compose.yml` — minimal stub (postgres only)
- `/home/z/my-project/retry-failure/README.md` — short overview

## Implementation steps

1. Enable pnpm:
   ```bash
   # KONDISI LOCAL (pnpm sudah terinstall):
   pnpm --version  # verify

   # KONDISI SANDBOX (pnpm belum terinstall):
   corepack enable pnpm
   corepack prepare pnpm@9.12.0 --activate
   pnpm --version  # verify
   ```
2. Buat root `package.json` — **WAJIB pin `packageManager` dan `engines`** agar kedua kondisi (LOCAL & SANDBOX) memakai pnpm v9.12.0 yang identik via corepack. Lockfile akan compatible di kedua lingkungan.
   ```json
   {
     "name": "retry-failure",
     "version": "0.1.0",
     "private": true,
     "engines": { "node": ">=20", "pnpm": ">=9" },
     "packageManager": "pnpm@9.12.0",
     "scripts": {
       "dev": "pnpm -r --parallel run dev",
       "build": "pnpm -r run build",
       "test": "pnpm -r run test",
       "test:e2e": "pnpm -r run test:e2e",
       "lint": "pnpm -r run lint",
       "typecheck": "pnpm -r run typecheck",
       "db:migrate": "pnpm --filter payment-api db:migrate",
       "db:migrate:revert": "pnpm --filter payment-api db:migrate:revert",
       "docker:up": "docker compose up -d",
       "docker:down": "docker compose down",
       "frontend:vue:dev": "pnpm --filter frontend-vue dev",
       "frontend:vue:build": "pnpm --filter frontend-vue build"
     },
     "devDependencies": {
       "typescript": "^5.6.0",
       "prettier": "^3.3.0",
       "eslint": "^9.0.0"
     }
   }
   ```
   - **`packageManager: "pnpm@9.12.0"`** — Node corepack membaca field ini dan otomatis activate pnpm v9.12.0 saat `pnpm` dipanggil. Kedua kondisi (LOCAL dengan pnpm global terinstall, SANDBOX dengan pnpm via corepack) akan resolve ke versi yang sama -> `pnpm-lock.yaml` compatible, tidak ada drift.
   - **`engines.node: ">=20"`** — Node v20, v22, v24 semua OK. Plan minta v20.19.0; kita pakai floor `>=20` agar sandbox (yang sering dapat v24) tetap jalan tanpa API breaking. Document caveat Node 24 vs 20 di TASK-15.
   - **`engines.pnpm: ">=9"`** — pelengkap pin `packageManager`; memberi error jelas bila ada dev yang masih pakai pnpm v8.
3. `pnpm-workspace.yaml`:
   ```yaml
   packages:
     - 'apps/*'
     - 'packages/*'
   ```
4. `tsconfig.base.json` strict mode, extends NestJS defaults.
5. **Buat dua env example files** — strategi Opsi B (lihat `docs/tasks/SANDBOX_NOTES.md` section 5):
   - `.env.example` — KONDISI LOCAL: `PORT=3000`, `GATEWAY_URL=http://localhost:3001`, DB credentials default untuk `docker compose postgres`.
   - `.env.sandbox.example` — KONDISI SANDBOX: `PORT=3001`, `GATEWAY_URL=http://localhost:3002`, DB credentials sama (asumsi external PostgreSQL) atau skip DB.
   - **Tidak buat `.env` di sini** — user/agent akan copy salah satu saat menjalankan task (lihat TASK-02 step 1).
   - Kedua file sudah committed (template). `.env` (aktual) di-gitignore.
6. **`.gitignore`** — pattern:
   ```gitignore
   .env
   .env.local
   .env.*.local
   !.env.example
   !.env.sandbox.example
   ```
   Artinya: `.env` (aktual) di-ignore, `.env.example` + `.env.sandbox.example` (template) di-commit.
7. `apps/payment-api/package.json`:
   ```json
   {
     "name": "payment-api",
     "version": "0.1.0",
     "private": true,
     "scripts": {
       "start:dev": "nest start --watch",
       "start": "node dist/main.js",
       "build": "nest build",
       "lint": "eslint src --ext .ts",
       "typecheck": "tsc --noEmit",
       "test": "jest",
       "test:e2e": "jest --config ./test/jest-e2e.json",
       "db:migrate": "typeorm migration:run -d src/data-source.ts",
       "db:migrate:revert": "typeorm migration:revert -d src/data-source.ts",
       "db:migration:generate": "typeorm migration:generate -d src/data-source.ts"
     },
     "dependencies": {
       "@nestjs/axios": "^3.1.0",
       "@nestjs/common": "^11.0.0",
       "@nestjs/config": "^3.2.0",
       "@nestjs/core": "^11.0.0",
       "@nestjs/platform-express": "^11.0.0",
       "@nestjs/schedule": "^4.1.0",
       "@nestjs/swagger": "^11.0.0",
       "axios": "^1.7.0",
       "class-transformer": "^0.5.1",
       "class-validator": "^0.14.1",
       "cockatiel": "^4.0.0",
       "joi": "^17.13.0",
       "nestjs-pino": "^4.1.0",
       "pg": "^8.12.0",
       "pino": "^9.4.0",
       "pino-http": "^10.3.0",
       "prom-client": "^15.1.0",
       "reflect-metadata": "^0.2.2",
       "rxjs": "^7.8.1",
       "typeorm": "^0.3.20"
     },
     "devDependencies": {
       "@nestjs/cli": "^11.0.0",
       "@nestjs/testing": "^11.0.0",
       "@types/jest": "^29.5.0",
       "@types/node": "^20.14.0",
       "@types/pg": "^8.11.0",
       "jest": "^29.7.0",
       "supertest": "^7.0.0",
       "ts-jest": "^29.2.0",
       "ts-node": "^10.9.0",
       "typescript": "^5.6.0"
     }
   }
   ```
6. `apps/payment-api/src/main.ts` — bootstrap NestJS, listen port 3001, enable Swagger.
7. `apps/payment-api/src/app.module.ts` — root module, import `ConfigModule.forRoot({ validationSchema })`.
8. `apps/payment-api/src/config/configuration.ts` — `() => ({...})` env loader.
9. `apps/payment-api/src/config/validation.schema.ts` — Joi schema untuk semua env dari plan section 15.
10. `apps/payment-api/src/config/config.module.ts` — `Global`, `ConfigModule.forRoot({ isGlobal: true })`.
11. `apps/payment-gateway-mock/` — same NestJS scaffolding, port 3002.
12. `apps/frontend-vue/` — Vite + Vue 3 + PrimeVue minimal:
    ```json
    {
      "name": "frontend-vue",
      "version": "0.1.0",
      "private": true,
      "type": "module",
      "scripts": {
        "dev": "vite --port 5173 --host",
        "build": "vue-tsc -b && vite build",
        "preview": "vite preview",
        "lint": "eslint src --ext .vue,.ts",
        "typecheck": "vue-tsc --noEmit"
      },
      "dependencies": {
        "vue": "^3.5.0",
        "vue-router": "^4.4.0",
        "pinia": "^2.2.0",
        "axios": "^1.7.0",
        "primevue": "^4.2.0",
        "primeicons": "^7.0.0",
        "@primevue/themes": "^4.2.0",
        "chart.js": "^4.4.0",
        "primevue-chart": "^4.2.0"
      },
      "devDependencies": {
        "@vitejs/plugin-vue": "^5.1.0",
        "typescript": "^5.6.0",
        "vite": "^5.4.0",
        "vue-tsc": "^2.1.0"
      }
    }
    ```
13. `packages/resilience/package.json`:
    ```json
    {
      "name": "@retry-failure/resilience",
      "version": "0.1.0",
      "private": true,
      "main": "src/index.ts",
      "types": "src/index.ts",
      "scripts": {
        "lint": "eslint src --ext .ts",
        "typecheck": "tsc --noEmit",
        "test": "jest"
      },
      "dependencies": {
        "cockatiel": "^4.0.0",
        "rxjs": "^7.8.1"
      },
      "devDependencies": {
        "typescript": "^5.6.0",
        "@types/node": "^20.14.0",
        "jest": "^29.7.0",
        "ts-jest": "^29.2.0"
      }
    }
    ```
14. `docker-compose.yml` — stub minimal:
    ```yaml
    services:
      postgres:
        image: postgres:16-alpine
        environment:
          POSTGRES_USER: retry_failure
          POSTGRES_PASSWORD: retry_failure
          POSTGRES_DB: retry_failure
        ports: ["5432:5432"]
        volumes:
          - pgdata:/var/lib/postgresql/data
          - ./docker/postgres/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
      jaeger:
        image: jaegertracing/all-in-one:1.60
        ports: ["16686:16686", "4318:4318"]
      prometheus:
        image: prom/prometheus:v2.54.0
        ports: ["9090:9090"]
        volumes:
          - ./docker/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      grafana:
        image: grafana/grafana:11.2.0
        ports: ["3003:3000"]
        volumes:
          - ./docker/grafana/provisioning:/etc/grafana/provisioning:ro
          - ./docker/grafana/dashboards:/var/lib/grafana/dashboards:ro
    volumes:
      pgdata:
    ```
15. Run `pnpm install` di root.

## Acceptance criteria

- [ ] `pnpm --version` works (via corepack).
- [ ] `pnpm install` di `/home/z/my-project/retry-failure/` berhasil tanpa error.
- [ ] `cd apps/payment-api && pnpm start:dev` bisa start NestJS di port 3001 (modal "Hello world" cukup).
- [ ] `cd apps/payment-gateway-mock && pnpm start:dev` bisa start di port 3002.
- [ ] `cd apps/frontend-vue && pnpm dev` bisa start Vite di port 5173.
- [ ] `apps/payment-api/src/config/validation.schema.ts` memuat Joi schema untuk semua env di plan section 15.
- [ ] Bila env wajib missing, `start:dev` gagal dengan error jelas (bukan silent).
- [ ] `pnpm typecheck` lulus untuk seluruh workspace.
- [ ] `pnpm lint` lulus.
- [ ] `docker compose up -d postgres` berhasil start PostgreSQL 16 (bila Docker tersedia).

## Useful commands (run after completing this task)

### Pre-flight Check

> **WAJIB BACA**: sebelum menjalankan command di bawah, cek kondisi lingkungan Anda via [`SANDBOX_NOTES.md`](./SANDBOX_NOTES.md) section 1 (Pre-flight Check).
>
> Ringkasan keyword:
> - `pnpm --version` ada -> KONDISI LOCAL. Tidak ada -> KONDISI SANDBOX -> jalankan `corepack enable pnpm && corepack prepare pnpm@9.12.0 --activate` dulu (versi pin ke `packageManager` field di root `package.json`).
> - `docker --version` ada -> KONDISI LOCAL. Tidak ada -> KONDISI SANDBOX -> butuh external PostgreSQL atau skip DB-dependent commands (lihat TASK-02).
> - `curl -s http://localhost:3000` sibuk -> KONDISI SANDBOX -> pakai PORT=3001 (payment-api), PORT=3002 (gateway-mock). Bebas -> KONDISI LOCAL -> pakai PORT=3000 (payment-api), PORT=3001 (gateway-mock).

Command di bawah ditulis dengan dua varian bila perlu (LOCAL / SANDBOX). Pilih salah satu sesuai kondisi.

---

```bash
# 1. Enable pnpm via corepack
# KONDISI LOCAL (pnpm sudah terinstall):
pnpm --version  # verify, expected 9.12.0 (auto via packageManager pin)

# KONDISI SANDBOX (pnpm belum terinstall):
corepack enable pnpm
corepack prepare pnpm@9.12.0 --activate
pnpm --version  # verify, expected 9.12.0

# 2. Install dependencies monorepo (sama kedua kondisi)
cd /home/z/my-project/retry-failure
pnpm install

# 3. Verify structure
ls -la apps/ packages/

# 4. Start payment-api (background)
# KONDISI LOCAL (port 3000 bebas):
cd /home/z/my-project/retry-failure/apps/payment-api
PORT=3000 pnpm start:dev > /tmp/payment-api.log 2>&1 &
sleep 5
tail -n 20 /tmp/payment-api.log
curl -s http://localhost:3000/ 2>&1 || echo "no route yet — OK if NestJS default 404"

# KONDISI SANDBOX (port 3000 dipakai Next.js preview):
cd /home/z/my-project/retry-failure/apps/payment-api
PORT=3001 pnpm start:dev > /tmp/payment-api.log 2>&1 &
sleep 5
tail -n 20 /tmp/payment-api.log
curl -s http://localhost:3001/ 2>&1 || echo "no route yet — OK if NestJS default 404"

# 5. Start gateway-mock (background)
# KONDISI LOCAL:
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock
PORT=3001 pnpm start:dev > /tmp/gateway-mock.log 2>&1 &
sleep 5
tail -n 20 /tmp/gateway-mock.log

# KONDISI SANDBOX:
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock
PORT=3002 pnpm start:dev > /tmp/gateway-mock.log 2>&1 &
sleep 5
tail -n 20 /tmp/gateway-mock.log

# 6. Start Vue frontend (background) — sama kedua kondisi (port 5173)
cd /home/z/my-project/retry-failure/apps/frontend-vue
pnpm dev > /tmp/frontend-vue.log 2>&1 &
sleep 5
tail -n 20 /tmp/frontend-vue.log
curl -s http://localhost:5173/ | head -20

# 7. Lint & typecheck — sama kedua kondisi
cd /home/z/my-project/retry-failure
pnpm lint
pnpm typecheck

# 8. Test config validation (start with missing env) — sama kedua kondisi
cd /home/z/my-project/retry-failure/apps/payment-api
unset DB_HOST DB_PORT DB_USER DB_PASS DB_NAME
pnpm start:dev 2>&1 | head -20  # expected: Joi validation error

# 9. Cleanup background services — sama kedua kondisi
pkill -f "nest start" 2>/dev/null
pkill -f "vite" 2>/dev/null

# 10. Verify Docker compose
# KONDISI LOCAL (Docker tersedia):
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml up -d postgres
sleep 5
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml ps
docker compose -f /home/z/my-project/retry-failure/docker-compose.yml down

# KONDISI SANDBOX (Docker tidak tersedia):
# Skip command ini. Butuh external PostgreSQL instance, atau gunakan mock repository untuk dev.
# Lihat SANDBOX_NOTES.md section 2.5 untuk strategi alternatif.
# Document caveat environment di TASK-15 production caveats.
```

## Notes

- **Node version**: sandbox punya Node v24. Plan minta v20.19.0. Pakai `engines.node: ">=20"` di root untuk fleksibel; di TASK-15 document ini sebagai caveat (Node 24 vs 20 — fitur ES yang dipakai tetap compatible).
- **pnpm via corepack**: lebih reliable daripada `npm i -g pnpm`.
- **NestJS CLI**: install sebagai devDependency di payment-api & gateway-mock (sudah ada di `devDependencies`).
- **TypeORM CLI**: ada di `node_modules/typeorm`; perlu `ts-node` untuk run migration yang masih `.ts`. Pakai `tsx` atau `ts-node` — pilih `ts-node` (lebih stabil dengan TypeORM).
- **Vue app**: Vite dev server di port 5173. Bila akses via preview panel sandbox gagal (port bukan 3000), tetap OK karena Vue dashboard adalah "resmi" bukan "sandbox preview" — diakses via tab baru.
- Setelah task ini selesai, sub-agent berikutnya bisa mulai paralel di TASK-02, TASK-03, TASK-04.
