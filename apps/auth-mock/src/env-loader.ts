/**
 * env-loader — adaptive dotenv loading for auth-mock (same pattern as payment-api).
 *
 * Plan reference: CODING_STANDARDS.md §Env Loading Patterns, AUTH-17.
 *
 * Solves 3 deployment scenarios:
 *   1. Dev/Sandbox: root monorepo `.env` (cwd = apps/auth-mock/)
 *   2. Standalone Docker: per-app `.env` di /app/ (cwd = /app/)
 *   3. Production k8s: env vars dari OS (tidak butuh .env file)
 *
 * dotenv behavior: does NOT override existing process.env vars.
 *   - Kalau Docker/k8s sudah set AUTH_ISSUER, dotenv.config() akan skip
 *   - Aman untuk production (env vars dari ConfigMap/Secrets)
 *
 * Usage:
 *   import { loadEnv } from './env-loader';
 *   loadEnv();  // Call di awal main.ts
 */
import { resolve } from 'node:path';

import { config } from 'dotenv';

/**
 * Resolve env file paths dengan 3 fallback strategies.
 *
 * Strategy 1: monorepo root `.env` (dev)
 *   - __dirname = apps/auth-mock/src/ → naik 3 level = retry-failure/
 *   - __dirname = apps/auth-mock/dist/ → naik 3 level = retry-failure/
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
    // apps/auth-mock/src/ → ../../../ = retry-failure/
    // apps/auth-mock/dist/ → ../../../ = retry-failure/
    resolve(fromDir, '..', '..', '..', '.env'),
    resolve(fromDir, '..', '..', '..', '.env.local'),

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
      if (process.env.NODE_ENV !== 'production') {
        // eslint-disable-next-line no-console -- debug log for env loading, only in non-production
        console.debug(`[env-loader] Loaded: ${path}`);
        // eslint-disable-next-line no-console -- debug log for env loading, only in non-production
        console.debug(`ACCESS_TOKEN_TTL: ${process.env.ACCESS_TOKEN_TTL}`);
      }
    }
  }
}
