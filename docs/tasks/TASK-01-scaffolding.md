# TASK-01 — Project Scaffolding & Dependencies

> **Task ID**: 1
> **Depends on**: —
> **Estimated effort**: S (~30 min)
> **Plan reference**: Section 3 (Stack Teknologi), Section 4 (Struktur Monorepo), Section 15 (Configuration)

---

## Goal

Menyiapkan struktur folder, dependency tambahan (Cockatiel, axios, pino, prom-client), dan konfigurasi environment yang divalidasi. Ini adalah fondasi yang dipakai semua task berikutnya.

## Scope

**In scope**:
- Install package: `cockatiel`, `axios`, `pino`, `pino-pretty`, `prom-client`.
- Buat struktur folder `src/lib/payments/` (sub-folder: `gateway/`, `resilience/`, `errors/`, `audit/`, `api/`).
- Buat `src/lib/observability/` (logger + metrics registry stub).
- Buat `src/lib/config.ts` — env validation pakai zod (semi-strict).
- Buat `.env.example` dengan semua key dari plan section 15.
- Update `package.json` scripts: tambah `typecheck` dan `gateway:dev` (untuk start mini-service).

**Out of scope**:
- Implementasi logger/metrics sebenarnya (di TASK-11).
- Implementasi Cockatiel policy (di TASK-05).
- Schema database (di TASK-02).

## Files to create / modify

- `/home/z/my-project/package.json` — tambah deps + scripts.
- `/home/z/my-project/.env.example` — semua env key.
- `/home/z/my-project/src/lib/config.ts` — env validation (zod).
- `/home/z/my-project/src/lib/payments/.gitkeep` — folder marker.
- `/home/z/my-project/src/lib/payments/gateway/.gitkeep`
- `/home/z/my-project/src/lib/payments/resilience/.gitkeep`
- `/home/z/my-project/src/lib/payments/errors/.gitkeep`
- `/home/z/my-project/src/lib/payments/audit/.gitkeep`
- `/home/z/my-project/src/lib/payments/api/.gitkeep`
- `/home/z/my-project/src/lib/observability/.gitkeep`

## Implementation steps

1. Install dependencies:
   ```bash
   bun add cockatiel axios pino pino-pretty prom-client
   ```
2. Buat struktur folder dengan `.gitkeep` agar tersimpan di VCS.
3. Tulis `src/lib/config.ts`:
   - Definisikan `ConfigSchema` (zod object) untuk semua env dari plan section 15 (kecuali DB MySQL — pakai `DATABASE_URL` Prisma yang sudah ada).
   - Tambah `PAYMENT_API_URL` (default `http://localhost:3000`) untuk scheduler.
   - Ekspor `config` singleton hasil parse + transform.
   - Kalau env tidak lengkap saat dev, lempar error jelas; jangan silent fail.
4. Tulis `.env.example` dengan semua key + komentar singkat.
5. Update `package.json` scripts:
   ```json
   {
     "typecheck": "tsc --noEmit",
     "gateway:dev": "cd mini-services/payment-gateway-mock && bun run dev",
     "scheduler:dev": "cd mini-services/retry-scheduler && bun run dev"
   }
   ```
6. Pastikan `tsconfig.json` sudah strict (cek `strict: true`).

## Acceptance criteria

- [ ] `bun add` berhasil tanpa error untuk semua package di atas.
- [ ] Folder `src/lib/payments/{gateway,resilience,errors,audit,api}` dan `src/lib/observability` ada.
- [ ] `src/lib/config.ts` mengekspor `config` object yang ter-type-safe.
- [ ] `.env.example` berisi semua key dari plan section 15 (diadaptasi: `DATABASE_URL` Prisma, `PAYMENT_API_URL`).
- [ ] `bun run lint` bersih.
- [ ] `bunx tsc --noEmit` bersih.

## Useful commands (run after completing this task)

```bash
# 1. Install dependencies (jika belum)
bun add cockatiel axios pino pino-pretty prom-client

# 2. Type check
bunx tsc --noEmit

# 3. Lint
bun run lint

# 4. Verifikasi struktur folder
ls -R /home/z/my-project/src/lib/payments /home/z/my-project/src/lib/observability

# 5. Verifikasi config terbaca (jalankan dev server sebentar lalu cek log)
bun run dev &
sleep 4
tail -n 30 /home/z/my-project/dev.log
# (matikan dev server dengan `kill %1` atau biarkan berjalan untuk task berikutnya)
```

## Notes

- **Adaptasi dari plan**: plan memakai `@nestjs/config` + class validator. Kita memakai zod (sudah ada di dependencies) karena lebih ringan dan idiomatic untuk Next.js.
- Cockatiel v4 adalah ESM-only. Pastikan `tsconfig.json` mendukung ESM import (Next.js 16 sudah default).
- **Jangan** install `@nestjs/*` apapun — kita bukan NestJS.
- File `.env.example` akan jadi template untuk `.env` (yang sudah ada / akan dibuat user).
- Setelah task ini selesai, sub-agent berikutnya bisa mulai paralel di TASK-02, TASK-03, TASK-04.
