/**
 * Env-var setup for payment-api integration tests.
 *
 * Plan reference: PLAN2 Section 17.2 (Integration tests), CODING_STANDARDS.md
 * §Env Loading Patterns (timing issue: `@nestjs/config` validates process.env
 * at MODULE EVALUATION TIME, not at instantiation).
 *
 * Why this file exists:
 *   `ConfigModule.forRoot({ validationSchema })` validates `process.env`
 *   synchronously when the `@Module` decorator is evaluated (at import time).
 *   This means env vars set INSIDE a test body (e.g. `process.env.DB_TYPE =
 *   'sqlite'` in `beforeAll`) are TOO LATE — Joi has already applied its
 *   default (`postgres`).
 *
 *   This file is imported at the TOP of `helpers/test-app.ts`, BEFORE
 *   `import { AppModule }`. ES module imports execute in source order, so
 *   our env vars are set before `AppModule` is loaded → before
 *   `ConfigModule.forRoot()` validates.
 *
 * What it sets:
 *   - DB_TYPE=sqlite + DB_SQLITE_PATH=:memory: — in-memory SQLite, no PostgreSQL.
 *   - SESSION_STORE=memory — in-process LRU, no Redis.
 *   - SESSION_SECRET — required by Joi schema (min 32 chars).
 *   - AUTH_BASE_URL, AUTH_ISSUER, OAUTH_* — required when AUTH_MODE != 'disabled'.
 *   - AUTH_DISABLED_* — required when AUTH_MODE = 'disabled' (set per-test).
 *
 * Coding standards: side-effect-only module (no exports); imported for its
 * `process.env` mutations. `setupFiles` in jest.config.js would also work,
 * but a side-effect import keeps the dependency explicit at the call site.
 */

// SQLite in-memory — no PostgreSQL required for integration tests.
process.env.DB_TYPE = 'sqlite';
process.env.DB_SQLITE_PATH = ':memory:';

// Session store — in-process LRU (no Redis required).
process.env.SESSION_STORE = 'memory';
process.env.SESSION_SECRET =
  process.env.SESSION_SECRET ?? 'test-secret-32-chars-min-aaaaaaaaa';
process.env.SESSION_COOKIE_NAME = 'sid';

// OAuth config (required by Joi when AUTH_MODE != 'disabled').
process.env.AUTH_BASE_URL = process.env.AUTH_BASE_URL ?? 'http://localhost:4001';
process.env.AUTH_ISSUER = process.env.AUTH_ISSUER ?? 'http://localhost:4001';
process.env.OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID ?? 'payment-api';
process.env.OAUTH_CLIENT_SECRET =
  process.env.OAUTH_CLIENT_SECRET ?? 'dev-client-secret';
process.env.OAUTH_REDIRECT_URI =
  process.env.OAUTH_REDIRECT_URI ?? 'http://localhost:3001/auth/callback';
process.env.OAUTH_SCOPES = process.env.OAUTH_SCOPES ?? 'openid profile';
process.env.JWT_AUDIENCE = process.env.JWT_AUDIENCE ?? 'payment-api';

// AUTH_MODE — 'mock' by default for OAuth flow tests. The disabled-mode test
// suite overrides this at runtime (auth.controller reads process.env.AUTH_MODE
// in the handler, so a runtime mutation works). SecurityOptions.authMode is
// also overridden via the SECURITY_OPTIONS provider in `buildTestApp`.
process.env.AUTH_MODE = process.env.AUTH_MODE ?? 'mock';

// Default disabled-user env vars (used when AUTH_MODE='disabled' is set later).
process.env.AUTH_DISABLED_USER_ID =
  process.env.AUTH_DISABLED_USER_ID ??
  '00000000-0000-1000-8000-000000000001';
process.env.AUTH_DISABLED_USERNAME =
  process.env.AUTH_DISABLED_USERNAME ?? 'disabled-user';
process.env.AUTH_DISABLED_ROLE_ID =
  process.env.AUTH_DISABLED_ROLE_ID ??
  '00000000-0000-1000-8000-000000000101';
process.env.AUTH_DISABLED_IS_SUPER_ADMIN =
  process.env.AUTH_DISABLED_IS_SUPER_ADMIN ?? 'true';
process.env.AUTH_DISABLED_PERMISSION_CODES =
  process.env.AUTH_DISABLED_PERMISSION_CODES ?? '*';

// Gateway URL — point at a non-routable address so accidental HTTP calls
// fail fast (ECONNREFUSED) instead of hanging. Short timeout so tests don't
// wait the full default 2s when this happens.
process.env.GATEWAY_URL = process.env.GATEWAY_URL ?? 'http://127.0.0.1:9';
process.env.GATEWAY_TIMEOUT_MS = process.env.GATEWAY_TIMEOUT_MS ?? '200';

// Frontend URL — BFF callback redirect target (AuthController.callback).
// Tests don't actually follow the redirect (supertest captures it), but
// Joi validation requires a valid URL or '/'. Set ke localhost:5173 (dev
// default) supaya konsisten dengan .env.example.
process.env.FRONTEND_URL = process.env.FRONTEND_URL ?? 'http://localhost:5173';

// Node env — test mode (drops TypeORM schema on init per db-config.ts).
process.env.NODE_ENV = 'test';

// Suppress verbose pino-pretty stdout output during tests.
process.env.LOG_LEVEL = process.env.LOG_LEVEL ?? 'warn';
