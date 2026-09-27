/**
 * env-loader — adaptive dotenv loading for monorepo + standalone deploy (AUTH-17 fix).
 *
 * Plan reference: CODING_STANDARDS.md, AUTH-17 deployment considerations.
 *
 * Solves 3 deployment scenarios:
 *   1. Dev/Sandbox: root monorepo `.env` (cwd = apps/payment-api/)
 *   2. Standalone Docker: per-app `.env` di /app/ (cwd = /app/)
 *   3. Production k8s: env vars dari OS (tidak butuh .env file)
 *
 * dotenv behavior: does NOT override existing process.env vars.
 *   - Kalau Docker/k8s sudah set DB_HOST, dotenv.config() akan skip DB_HOST
 *   - Aman untuk production (env vars dari ConfigMap/Secrets)
 *
 * Usage:
 *   import { loadEnv } from './env-loader';
 *   loadEnv();  // Call di awal main.ts + data-source.ts + security.config.ts
 */
import { config } from 'dotenv';
import { resolve } from 'node:path';

/**
 * Resolve env file paths dengan 3 fallback strategies.
 *
 * Strategy 1: monorepo root `.env` (dev)
 *   - __dirname = apps/payment-api/src/ → naik 4 level = retry-failure/
 *   - __dirname = apps/payment-api/dist/ → naik 4 level = retry-failure/
 *   - Match dengan db:migrate script `--env-file=../../.env`
 *
 * Strategy 2: per-app `.env` (standalone Docker)
 *   - cwd mungkin = /app/ (Docker WORKDIR)
 *   - Baca /app/.env langsung
 *
 * Strategy 3: OS env vars (production k8s)
 *   - Tidak ada .env file — env vars di-set oleh ConfigMap/Secrets
 *   - dotenv.config() aman: tidak override existing process.env
 *
 * @param fromDir - __dirname dari caller (untuk resolve monorepo root)
 */
export function loadEnv(fromDir: string = __dirname): void {
  const envPaths = [
    // Strategy 1: monorepo root (dev sandbox)
    // apps/payment-api/src/ → ../../../../ = retry-failure/
    // apps/payment-api/dist/ → ../../../../ = retry-failure/
    resolve(fromDir, '..', '..', '..', '..', '.env'),
    resolve(fromDir, '..', '..', '..', '..', '.env.local'),

    // Strategy 2: per-app (standalone Docker, cwd = /app/)
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '.env.local'),

    // Strategy 3: per-app relative ke __dirname (fallback)
    resolve(fromDir, '..', '.env'),
    resolve(fromDir, '..', '.env.local'),
  ];

  // dotenv.config() aman untuk production:
  // - Kalau file tidak ada → no-op (debug log, bukan error)
  // - Kalau file ada → load vars, TIDAK override existing process.env
  for (const path of envPaths) {
    const result = config({ path });
    if (result.parsed) {
      // Only log kalau file ada + berhasil parse (debug only, bukan error)
      // Jangan log di production untuk avoid noise
      if (process.env.NODE_ENV !== 'production') {
        console.debug(`[env-loader] Loaded: ${path}`);
      }
    }
    // Kalau result.error (file not found) → skip silently, coba path berikutnya
  }
}
