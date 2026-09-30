/**
 * bootstrap-validation — fail-fast env validation at startup (AUTH-24).
 *
 * Plan reference: PLAN2 Section 14.6 + Section 9.4 + AUTH-24 §acceptance criteria.
 *
 * Extracted from `apps/payment-api/src/main.ts` (original inline `validateConfig()`)
 * into a pure exported function so it can be unit-tested in isolation by
 * `packages/security/tests/bootstrap-validation.spec.ts`.
 *
 * Behavior:
 *   - NODE_ENV=production + AUTH_MODE=mock       → throw (mock is dev-only).
 *   - NODE_ENV=production + AUTH_MODE=disabled    → throw (disabled is dev/test-only).
 *   - NODE_ENV=production + SESSION_STORE=memory  → throw (no multi-instance).
 *   - SESSION_STORE=redis + no REDIS_URL          → throw (Redis URL required) — any NODE_ENV.
 *   - All other combinations                      → pass (no throw).
 *
 * The function takes an explicit `env` parameter instead of reading
 * `process.env` directly so tests can inject controlled env maps without
 * mutating global state (cleaner than beforeEach/afterEach save-restore).
 * Callers pass `process.env` in production.
 */

/**
 * Validate bootstrap env vars. Throws on insecure combinations.
 *
 * @param env - Process env (typically `process.env`)
 * @throws {Error} when a production-insecure combination is detected
 */
export function validateBootstrapConfig(env: NodeJS.ProcessEnv): void {
  const { NODE_ENV, AUTH_MODE, SESSION_STORE, REDIS_URL } = env;

  if (NODE_ENV === 'production') {
    if (AUTH_MODE === 'mock') {
      throw new Error(
        'AUTH_MODE=mock tidak boleh di production — pakai AUTH_MODE=oauth',
      );
    }
    if (AUTH_MODE === 'disabled') {
      throw new Error(
        'AUTH_MODE=disabled tidak boleh di production — pakai AUTH_MODE=oauth',
      );
    }
    if (SESSION_STORE === 'memory') {
      throw new Error(
        'SESSION_STORE=memory tidak boleh di production — pakai SESSION_STORE=redis',
      );
    }
  }

  if (SESSION_STORE === 'redis' && !REDIS_URL) {
    throw new Error(
      'REDIS_URL wajib diisi kalau SESSION_STORE=redis',
    );
  }
}
