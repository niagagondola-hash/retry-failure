# Sandbox Notes - Adaptasi Implementasi per Lingkungan

> **File ini WAJIB dibaca sebelum menjalankan task apapun.**
> Plan asli (`upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md`) menjelaskan arsitektur ideal tanpa anotasi lingkungan.
> File ini berisi kondisional command untuk menyesuaikan implementasi dengan kondisi tempat task dijalankan:
> - **Kondisi Local** - environment development user (Docker, pnpm, PostgreSQL native tersedia)
> - **Kondisi Sandbox** - environment cloud Z.ai (keterbatasan port, tidak ada Docker, pnpm via corepack)

---

## 0. Cara Pakai File Ini

Sebelum mulai task apapun, jalankan **Pre-flight Check** (section 1 di bawah). Hasilnya menentukan kondisi mana yang berlaku. Setiap task file (`TASK-*.md`) punya section "Useful commands" yang merujuk ke file ini untuk command yang berbeda per kondisi.

**Aturan praktis:**
- Bila command native tersedia -> gunakan langsung (Kondisi Local)
- Bila command native TIDAK tersedia -> gunakan alternatif yang dicatat di sini (Kondisi Sandbox)

---

## 1. Pre-flight Check (jalankan sekali sebelum task pertama)

```bash
# === DETEKSI KONDISI LINGKUNGAN ===

echo "=== 1. Pnpm ==="
if command -v pnpm &>/dev/null; then
  echo "✓ pnpm tersedia (KONDISI LOCAL)"
  PNPM_CMD="pnpm"
else
  echo "✗ pnpm tidak tersedia (KONDISI SANDBOX)"
  echo "  -> aktifkan via corepack:"
  echo "  corepack enable pnpm"
  echo "  corepack prepare pnpm@latest --activate"
  PNPM_CMD="corepack pnpm"
fi

echo ""
echo "=== 2. Node version ==="
node --version
# Plan minta v20.19.0. Bila dapat v24.x (sandbox), acceptable - fitur ES kompatibel.

echo ""
echo "=== 3. Docker ==="
if command -v docker &>/dev/null; then
  echo "✓ docker tersedia (KONDISI LOCAL)"
  DOCKER_AVAILABLE=1
else
  echo "✗ docker tidak tersedia (KONDISI SANDBOX)"
  echo "  -> PostgreSQL butuh external instance atau skip integration test"
  DOCKER_AVAILABLE=0
fi

echo ""
echo "=== 4. PostgreSQL client (psql) ==="
if command -v psql &>/dev/null; then
  echo "✓ psql tersedia"
else
  echo "✗ psql tidak tersedia -> verifikasi schema via Node script, bukan psql CLI"
fi

echo ""
echo "=== 5. Bun (untuk Next.js frontend) ==="
if command -v bun &>/dev/null; then
  echo "✓ bun tersedia"
else
  echo "✗ bun tidak tersedia -> install via npm i -g bun atau skip Next.js frontend"
fi

echo ""
echo "=== 6. Port 3000 availability ==="
if curl -s http://localhost:3000 >/dev/null 2>&1; then
  echo "✗ port 3000 sudah dipakai (KONDISI SANDBOX - ada Next.js preview)"
  PORT_OFFSET=1  # payment-api -> 3001, gateway-mock -> 3002
else
  echo "✓ port 3000 kosong (KONDISI LOCAL)"
  PORT_OFFSET=0
fi

echo ""
echo "=== 7. Monorepo location ==="
ls -d /home/z/my-project/retry-failure 2>/dev/null && echo "✓ monorepo root ada"
```

---

## 2. Command Matrix per Kondisi

### 2.1 Pnpm install

```bash
# Deteksi:
if command -v pnpm &>/dev/null; then
  echo "KONDISI LOCAL"
  pnpm install
else
  echo "KONDISI SANDBOX"
  corepack enable pnpm
  corepack prepare pnpm@latest --activate
  pnpm install
fi
```

**Keyword**: `pnpm --version` -> bila output version string, KONDISI LOCAL. Bila "command not found", KONDISI SANDBOX.

### 2.2 Run dev server (payment-api)

```bash
# KONDISI LOCAL (port 3000 bebas):
cd /home/z/my-project/retry-failure/apps/payment-api
PORT=3000 pnpm start:dev
# -> payment-api di port 3000

# KONDISI SANDBOX (port 3000 dipakai Next.js preview):
cd /home/z/my-project/retry-failure/apps/payment-api
PORT=3001 pnpm start:dev
# -> payment-api di port 3001
```

**Keyword**: `curl -s http://localhost:3000 >/dev/null && echo "SANDOX" || echo "LOCAL"`. Bila port 3000 sibuk -> pakai 3001.

### 2.3 Run dev server (gateway-mock)

```bash
# KONDISI LOCAL:
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock
PORT=3001 pnpm start:dev
# -> gateway-mock di port 3001

# KONDISI SANDBOX:
cd /home/z/my-project/retry-failure/apps/payment-gateway-mock
PORT=3002 pnpm start:dev
# -> gateway-mock di port 3002
```

### 2.4 Setup env file (.env) berdasarkan kondisi

Strategi: **dua env example files** yang di-commit. Copy salah satu jadi `.env` (aktual). Lihat section 5 untuk detail lengkap.

```bash
cd /home/z/my-project/retry-failure/apps/payment-api

# KONDISI LOCAL:
cp ../../.env.example .env
# Default sudah set: PORT=3000, GATEWAY_URL=http://localhost:3001, DB credentials docker compose.
# Tidak perlu edit manual.

# KONDISI SANDBOX:
cp ../../.env.sandbox.example .env
# Default sudah set: PORT=3001, GATEWAY_URL=http://localhost:3002 (port shift karena Next.js preview di 3000).
# Bila ada external PostgreSQL dengan credentials berbeda -> edit DB_* sesuai instance.
# Bila TIDAK ada DB -> skip migration + gunakan mock repository.
```

### 2.5 PostgreSQL setup

```bash
# KONDISI LOCAL (Docker tersedia):
cd /home/z/my-project/retry-failure
docker compose up -d postgres
sleep 5
docker compose ps postgres
# -> PostgreSQL di localhost:5432

# KONDISI SANDBOX (Docker tidak tersedia):
# Opsi A: connect ke external PostgreSQL instance (set DB_HOST, DB_PORT, DB_USER, DB_PASS, DB_NAME)
# Opsi B: skip DB integration test, gunakan in-memory mock repository untuk dev
# Opsi C: install postgresql Native via apt (butuh sudo, tidak ada di sandbox default)

# Verifikasi koneksi ( kedua kondisi ):
psql -h localhost -U retry_failure -d retry_failure -c "SELECT 1;"
# atau via Node script:
# pnpm exec ts-node -e "import { Client } from 'pg'; const c = new Client({...}); await c.connect(); console.log('ok'); await c.end();"
```

**Keyword**: `docker --version` -> bila ada version string, KONDISI LOCAL. Bila "command not found", KONDISI SANDBOX -> gunakan external PostgreSQL atau skip.

### 2.6 Verify DB schema

```bash
# KONDISI LOCAL (psql via docker exec atau host):
docker compose exec postgres psql -U retry_failure -d retry_failure -c '\dt'
docker compose exec postgres psql -U retry_failure -d retry_failure -c '\dT'

# KONDISI SANDBOX (psql di host atau via Node script):
psql -h localhost -U retry_failure -d retry_failure -c '\dt'
# atau bila psql tidak ada:
pnpm exec ts-node -e "
import { Client } from 'pg';
const c = new Client({ host: 'localhost', port: 5432, user: 'retry_failure', password: 'retry_failure', database: 'retry_failure' });
await c.connect();
const t = await c.query(\"SELECT table_name FROM information_schema.tables WHERE table_schema='public'\");
console.log(t.rows);
await c.end();
"
```

### 2.7 TypeORM migration

```bash
# Sama untuk kedua kondisi (asalkan DB dapat diakses):
cd /home/z/my-project/retry-failure/apps/payment-api
pnpm db:migrate
pnpm db:migrate:revert
```

Bila DB tidak bisa diakses (KONDISI SANDBOX tanpa external PostgreSQL):
- Skip migration, gunakan mock repository untuk dev
- Document caveat di TASK-15 production caveats

### 2.8 Lint & typecheck (sama untuk kedua kondisi)

```bash
cd /home/z/my-project/retry-failure
pnpm lint
pnpm typecheck

# Per-app:
pnpm --filter payment-api lint
pnpm --filter payment-api typecheck
pnpm --filter @retry-failure/resilience test
```

### 2.9 Run tests

```bash
# KONDISI LOCAL (Docker up):
docker compose up -d postgres
cd /home/z/my-project/retry-failure/apps/payment-api
pnpm test
pnpm test:e2e

# KONDISI SANDBOX (tanpa Docker):
# - Unit test (tidak butuh DB): tetap jalan
pnpm --filter payment-api test

# - E2E test (butuh DB): skip atau gunakan mock
# Bila external PG ada:
pnpm test:e2e
# Bila tidak: document caveat, skip E2E
```

### 2.10 Next.js frontend (TASK-12)

```bash
# KONDISI LOCAL (port 3000 bebas):
cd /path/to/nextjs-frontend
bun run dev
# atau pnpm dev
# -> Next.js di port 3000

# KONDISI SANDBOX (sudah ada Next.js preview di port 3000):
# Next.js di parent root /home/z/my-project/ sudah otomatis berjalan di port 3000
# Tidak perlu start manual
bun run dev  # bila belum jalan
```

### 2.11 Vue frontend (TASK-13)

```bash
# Sama untuk kedua kondisi:
cd /home/z/my-project/retry-failure/apps/frontend-vue
pnpm dev
# -> Vite di port 5173

# Akses:
# KONDISI LOCAL: http://localhost:5173 di browser
# KONDISI SANDBOX: klik "Open in New Tab" di preview panel (port 5173 di-expose via Caddy)
```

### 2.12 Cross-service fetch (dari Next.js sandbox)

```bash
# Hanya relevan di KONDISI SANDBOX (Next.js preview di port 3000):

# Caddy gateway memforward request dengan ?XTransformPort=NNNN ke port NNNN
# Frontend code (client-side fetch):
fetch('/api/payments?XTransformPort=3001')              # -> payment-api:3001
fetch('/admin/config?XTransformPort=3002', { method: 'PUT' })  # -> gateway-mock:3002

# JANGAN hardcode:
# fetch('http://localhost:3001/api/payments')  # ❌ akan break di sandbox preview

# KONDISI LOCAL: fetch langsung ke http://localhost:3000/api/payments (tanpa XTransformPort)
```

---

## 3. Task-by-Task Adaptation Notes

Setiap task di `retry-failure/docs/plan1-cockatiel-retry-failure/tasks/TASK-*.md` punya section "Useful commands". Saat menjalankan command tersebut, cek dulu kondisi lingkungan. Berikut adaptasi yang perlu diingat per task:

### TASK-01 (Scaffolding)
- KONDISI SANDBOX: jalankan `corepack enable pnpm` sebelum `pnpm install`
- KONDISI LOCAL: `pnpm install` langsung

### TASK-02 (Database)
- KONDISI LOCAL: `docker compose up -d postgres` lalu `pnpm db:migrate`
- KONDISI SANDBOX: butuh external PostgreSQL instance, atau skip migration + pakai mock repository

### TASK-03 (Gateway Mock)
- KONDISI LOCAL: `PORT=3001 pnpm start:dev`
- KONDISI SANDBOX: `PORT=3002 pnpm start:dev` (port 3001 mungkin dipakai payment-api)

### TASK-05 (Cockatiel Resilience)
- Tidak ada adaptasi - pure TypeScript package

### TASK-09 (API Routes)
- KONDISI LOCAL: payment-api di port 3000 -> curl `http://localhost:3000/api/payments`
- KONDISI SANDBOX: payment-api di port 3001 -> curl `http://localhost:3001/api/payments`

### TASK-10 (Retry Scheduler)
- Tidak ada adaptasi - scheduler in-process di NestJS, tidak butuh port terpisah

### TASK-11 (Observability)
- Tidak ada adaptasi - prom-client + pino jalan di proses yang sama

### TASK-12 (Next.js Frontend)
- KONDISI LOCAL: `cd /path/to/nextjs && bun run dev` (port 3000)
- KONDISI SANDBOX: Next.js sudah otomatis berjalan di port 3000 (preview panel)
- Untuk akses backend dari Next.js sandbox, gunakan `?XTransformPort` di fetch

### TASK-13 (Vue Frontend)
- Sama untuk kedua kondisi: `cd apps/frontend-vue && pnpm dev` (port 5173)

### TASK-14 (E2E Scenarios)
- KONDISI LOCAL: `pnpm test:e2e` dengan DB lokal
- KONDISI SANDBOX: bila tidak ada DB, skip E2E scenarios yang butuh persistence (1, 4, 6, 7). Pure API scenarios (2, 3, 5) tetap bisa jalan dengan gateway mock saja.

### TASK-15 (Documentation)
- Document caveat environment di `PRODUCTION_CAVEATS.md`

---

## 4. Keyword Quick Reference

| Cek command | Output "ada" | Output "tidak ada" |
|---|---|---|
| `command -v pnpm` | KONDISI LOCAL - `pnpm install` langsung | KONDISI SANDBOX - `corepack enable pnpm` dulu |
| `command -v docker` | KONDISI LOCAL - `docker compose up -d postgres` | KONDISI SANDBOX - butuh external PG atau mock |
| `command -v psql` | verifikasi schema via psql CLI | verifikasi via Node script `pg.Client` |
| `command -v bun` | KONDISI LOCAL - `bun run dev` untuk Next.js | install via `npm i -g bun` atau skip Next.js |
| `curl -s localhost:3000` | KONDISI SANDBOX - port 3000 sibuk, payment-api ke 3001 | KONDISI LOCAL - port 3000 bebas untuk payment-api |
| `node --version` | check >= v20 (plan pin) | bila < v20, upgrade dulu |

---

## 5. Env File Strategy (Opsi B - Dua Example Files)

Project menggunakan strategi **dua env example files** yang di-commit ke repository:

```
retry-failure/
├── .env.example           ← committed, KONDISI LOCAL (port 3000, gateway 3001, Docker available)
├── .env.sandbox.example   ← committed, KONDISI SANDBOX (port 3001, gateway 3002, no Docker)
├── .gitignore             ← ignore .env (aktual), allow .env.example + .env.sandbox.example
└── apps/payment-api/
    └── .env               ← gitignored, file aktual yang dipakai aplikasi
```

### Cara Pakai

**KONDISI LOCAL** (Docker tersedia, pnpm terinstall, port 3000 bebas):

```bash
cd /home/z/my-project/retry-failure/apps/payment-api
cp ../../.env.example .env
# Tidak perlu edit manual. Default sudah set DB credentials untuk docker compose postgres.
# Jalankan:
docker compose -f ../../docker-compose.yml up -d postgres
pnpm db:migrate
pnpm start:dev   # payment-api di port 3000
```

**KONDISI SANDBOX** (Docker tidak tersedia, pnpm via corepack, port 3000 dipakai Next.js preview):

```bash
cd /home/z/my-project/retry-failure/apps/payment-api
cp ../../.env.sandbox.example .env
# Bila ada external PostgreSQL -> edit DB_HOST/DB_USER/DB_PASS/DB_NAME sesuai instance.
# Bila TIDAK ada DB -> skip migration + gunakan mock repository.
# Jalankan:
corepack enable pnpm
corepack prepare pnpm@9.12.0 --activate
pnpm install
pnpm db:migrate   # bila DB accessible
pnpm start:dev    # payment-api di port 3001 (port 3000 dipakai Next.js preview)
```

### Perbandingan isi kedua file

| Variable | `.env.example` (LOCAL) | `.env.sandbox.example` (SANDBOX) |
|---|---|---|
| `PORT` | 3000 | 3001 |
| `GATEWAY_URL` | http://localhost:3001 | http://localhost:3002 |
| `GATEWAY_TIMEOUT_MS` | 2000 | 2000 (sama) |
| `RETRY_*`, `BREAKER_*`, `MAX_TOTAL_RETRIES`, `SCHEDULER_INTERVAL_MS` | sama | sama (config aplikasi tidak bergantung lingkungan) |
| `DB_HOST` | localhost | localhost (asumsi external PG di host yang sama) |
| `DB_PORT` | 5432 | 5432 (sama) |
| `DB_USER` / `DB_PASS` / `DB_NAME` / `DB_SCHEMA` | retry_failure (docker compose default) | retry_failure (asumsi external PG pakai credentials sama) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | http://localhost:4318 | http://localhost:4318 (Jaeger mungkin tidak jalan di sandbox -> no-op) |
| `LOG_LEVEL` | info | info |

### Catatan penting

1. **Kedua file example di-commit** ke repository. File `.env` (aktual) di-gitignore.
2. **Tidak ada edit manual** bila default sesuai. User/agent cukup `cp` salah satu.
3. **Bila DB credentials berbeda** dari default (mis. external PostgreSQL di sandbox pakai password lain), edit `.env` setelah copy. Jangan edit file `.example` - itu adalah template.
4. **`.env.local`** (opsional) untuk personal override user. Juga di-gitignore.
5. **Jangan hardcode** port atau URL di kode aplikasi. Selalu baca dari env (`process.env.PORT`, `process.env.GATEWAY_URL`, dst.). Ini memungkinkan aplikasi jalan di kedua kondisi tanpa perubahan kode.

### Why Opsi B (bukan C atau D)

- **Opsi C** (NODE_ENV switch via `@nestjs/config` `envFilePath`): kompleks, butuh `NODE_ENV` env var untuk switch, bisa conflict key. Tidak worth untuk use case kita (sandbox selalu sandbox, local selalu local).
- **Opsi D** (1 file dengan commented blocks): rawan human error (lupa uncomment atau comment tidak konsisten). Tidak rekomendasi.
- **Opsi B** (copy pattern): paling simple, paling eksplisit, paling reliable. Agent sandbox bisa `cp .env.sandbox.example .env` -> langsung jalan. User local bisa `cp .env.example .env` -> langsung jalan.

---

## 6. Quick Decision Tree

```
Mulai task
  │
  ├── pnpm --version ?
  │     ├── ada  -> KONDISI LOCAL  -> pnpm install langsung
  │     └── tidak -> KONDISI SANDBOX -> corepack enable pnpm dulu
  │
  ├── docker --version ?
  │     ├── ada  -> KONDISI LOCAL  -> docker compose up -d postgres
  │     └── tidak -> KONDISI SANDBOX -> cek DB_HOST env
  │                  ├── ada external PG -> connect langsung
  │                  └── tidak ada       -> skip DB tests, pakai mock repository
  │
  ├── curl localhost:3000 ?
  │     ├── sibuk -> KONDISI SANDBOX -> payment-api di 3001, gateway di 3002
  │     └── bebas -> KONDISI LOCAL   -> payment-api di 3000, gateway di 3001
  │
  └── Selesai: mulai task sesuai urutan
```

---

## 7. Catatan Penting

1. **File ini bukan bagian dari plan asli**. Plan asli (`upload/PLAN1_Cockatiel_Retry_Failure_Scenario.md`) menjelaskan arsitektur ideal. File ini hanya bridge antara plan dan kondisi lingkungan aktual saat eksekusi.

2. **Bila menemukan kondisi baru** yang tidak tercover di sini, tambahkan ke file ini (append mode) dan update worklog.

3. **Kondisi bisa berubah**. Selalu jalankan Pre-flight Check (section 1) di awal sesi baru, jangan asumsi kondisi sama dengan sesi sebelumnya.

4. **Jangan hardcode port atau URL di kode aplikasi**. Selalu baca dari env (`process.env.PORT`, `process.env.GATEWAY_URL`, dst.). Ini memungkinkan aplikasi jalan di kedua kondisi tanpa perubahan kode.

5. **Verifikasi via curl** lebih reliable daripada `command -v` karena mendeteksi service aktif, bukan hanya binary tersedia. Contoh: `pnpm` mungkin terinstall tapi service tertentu tidak berjalan.

---

## 8. Reference: Task File Index

Lihat `README.md` di folder yang sama untuk:
- Daftar lengkap task files (`TASK-01` sampai `TASK-15`)
- Dependency graph
- Execution order
- Definition of Done checklist

Setiap task file punya section "Useful commands" yang mengasumsikan salah satu kondisi di atas. Bila ragu, kembali ke file ini.
