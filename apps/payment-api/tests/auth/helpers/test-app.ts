/**
 * Test app bootstrap helper for payment-api integration tests.
 *
 * Plan reference: PLAN2 Section 17.2 (Integration tests), Section 9
 * (packages/security), AUTH-25 task spec §3 (test-app.ts).
 *
 * Strategy:
 *   - Bootstrap real `AppModule` via `Test.createTestingModule` + `app.init()`
 *     so all middleware, guards, pipes, and interceptors run end-to-end.
 *   - Override `OAuthClientService` with a Jest mock so no real HTTP calls
 *     to auth-mock are made (each test configures its return values).
 *   - Override `JWT_VERIFIER` with a Jest mock so no real JWKS fetch happens.
 *   - Override `SESSION_STORE` with a real `MemorySessionStore` instance the
 *     test holds a reference to — so `createTestSession` can seed sessions
 *     directly without going through the OAuth flow.
 *   - Override `SECURITY_OPTIONS` with a per-app `SecurityOptions` object so
 *     each test suite can run with a different `authMode` ('mock' vs
 *     'disabled') without re-importing `AppModule`. (SecurityModule's
 *     `forRootAsync` factory still runs, but its result is overridden — so
 *     `ConfigService` caching quirks don't leak.)
 *   - DB: SQLite in-memory (`DB_TYPE=sqlite`, `DB_SQLITE_PATH=:memory:`)
 *     set in `tests/auth/setup-env.ts` BEFORE `AppModule` import (so Joi
 *     validation sees them — see setup-env.ts for the timing details).
 *
 * CSRF: enabled by default. Tests that POST must send `XSRF-TOKEN` cookie +
 * `X-CSRF-Token` header (matching values) — see `buildCsrfHeaders()` below.
 *
 * Coding standards: per CODING_STANDARDS.md §Test Conventions, this is an
 * integration test (`*.integration.spec.ts`) using real dependencies +
 * supertest HTTP requests.
 */
// IMPORTANT: setup-env MUST be imported before AppModule so process.env
// mutations land before `ConfigModule.forRoot()` validates env vars.
// (See setup-env.ts for the timing explanation.)
import '../setup-env';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Response as SupertestResponse } from 'supertest';

import { AppModule } from '../../../src/app.module';
import {
  JWT_VERIFIER,
  MemorySessionStore,
  OAuthClientService,
  SECURITY_OPTIONS,
  type SecurityOptions,
  SESSION_STORE,
  SessionStore,
} from '@retry-failure/security';

/**
 * Snapshot of env vars we mutate during `buildTestApp` so `closeTestApp` can
 * restore the previous values. Prevents env bleed when the disabled-mode app
 * sets AUTH_MODE='disabled' then the mock-mode app expects AUTH_MODE='mock'.
 */
interface EnvSnapshot {
  AUTH_MODE?: string;
  AUTH_DISABLED_USER_ID?: string;
  AUTH_DISABLED_USERNAME?: string;
  AUTH_DISABLED_ROLE_ID?: string;
  AUTH_DISABLED_IS_SUPER_ADMIN?: string;
  AUTH_DISABLED_PERMISSION_CODES?: string;
  CSRF_ENABLED?: string;
}

/**
 * Mock shape for OAuthClientService. Each method is a Jest mock so tests
 * can configure return values per-scenario.
 */
export type MockedOAuthClientService = {
  [K in keyof OAuthClientService]: jest.Mock;
};

/** Mock shape for JwtVerifier. */
export interface MockedJwtVerifier {
  verify: jest.Mock;
  verifyAuthUser: jest.Mock;
}

/** Result of `buildTestApp` — everything a test needs to drive the app. */
export interface TestApp {
  /** NestJS application (call `getHttpServer()` for supertest). */
  app: INestApplication;
  /** The TestingModule — useful for resolving providers in tests. */
  module: TestingModule;
  /** Mocked OAuthClientService — configure return values per test. */
  oauthClient: MockedOAuthClientService;
  /** Mocked JWT verifier — configure return values per test. */
  jwtVerifier: MockedJwtVerifier;
  /** In-memory session store — seed sessions directly via `createTestSession`. */
  sessionStore: MemorySessionStore;
  /** Env snapshot — restored by `closeTestApp`. */
  envSnapshot: EnvSnapshot;
}

/** Options for `buildTestApp`. */
export interface TestAppOptions {
  /**
   * AUTH_MODE — 'mock' (default) for OAuth flow tests; 'disabled' for the
   * disabled-mode test suite (fake user from env).
   */
  authMode?: 'mock' | 'oauth' | 'disabled';
  /**
   * Override the disabled-user env vars (only used when `authMode='disabled'`).
   * Defaults match `validation.schema.ts` defaults.
   */
  disabledUser?: {
    userId: string;
    username: string;
    roleId: string;
    isSuperAdmin: boolean;
    permissionCodes: string; // '*' or comma-separated
  };
  /**
   * Disable CSRF validation (default: false). Set to true to skip CSRF
   * checks without sending the XSRF-TOKEN cookie + header.
   */
  csrfEnabled?: boolean;
}

/** Default disabled-user config (matches validation.schema.ts defaults). */
const DEFAULT_DISABLED_USER = {
  userId: '00000000-0000-1000-8000-000000000001',
  username: 'disabled-user',
  roleId: '00000000-0000-1000-8000-000000000101',
  isSuperAdmin: true,
  permissionCodes: '*',
} as const;

/**
 * Snapshot the env vars we're about to override. Caller restores them
 * via `closeTestApp()` to prevent env bleed across test suites.
 */
function snapshotEnv(): EnvSnapshot {
  return {
    AUTH_MODE: process.env.AUTH_MODE,
    AUTH_DISABLED_USER_ID: process.env.AUTH_DISABLED_USER_ID,
    AUTH_DISABLED_USERNAME: process.env.AUTH_DISABLED_USERNAME,
    AUTH_DISABLED_ROLE_ID: process.env.AUTH_DISABLED_ROLE_ID,
    AUTH_DISABLED_IS_SUPER_ADMIN: process.env.AUTH_DISABLED_IS_SUPER_ADMIN,
    AUTH_DISABLED_PERMISSION_CODES: process.env.AUTH_DISABLED_PERMISSION_CODES,
    CSRF_ENABLED: process.env.CSRF_ENABLED,
  };
}

/**
 * Apply runtime env vars for the requested test mode. These vars are read
 * by code at REQUEST time (e.g. `auth.controller` reads `process.env.AUTH_MODE`
 * inside handler bodies, NOT at module init), so per-test mutation works.
 *
 * For env vars read at MODULE INIT time (DB_TYPE, SESSION_STORE, etc.),
 * see `tests/auth/setup-env.ts` — those MUST be set before `AppModule` import.
 */
function applyEnvForMode(options: TestAppOptions): void {
  const mode = options.authMode ?? 'mock';
  process.env.AUTH_MODE = mode;

  if (mode === 'disabled') {
    const du = options.disabledUser ?? DEFAULT_DISABLED_USER;
    process.env.AUTH_DISABLED_USER_ID = du.userId;
    process.env.AUTH_DISABLED_USERNAME = du.username;
    process.env.AUTH_DISABLED_ROLE_ID = du.roleId;
    process.env.AUTH_DISABLED_IS_SUPER_ADMIN = du.isSuperAdmin
      ? 'true'
      : 'false';
    process.env.AUTH_DISABLED_PERMISSION_CODES = du.permissionCodes;
  }
}

/**
 * Build the SecurityOptions object for the requested mode.
 *
 * Used as the override value for the SECURITY_OPTIONS provider — this
 * bypasses SecurityModule's forRootAsync factory (which reads ConfigService,
 * which caches validated env at module-import time, making per-test AUTH_MODE
 * changes invisible).
 *
 * @param options - Test options (authMode, disabledUser, csrfEnabled).
 * @returns A complete SecurityOptions object for the test app.
 */
function buildSecurityOptions(options: TestAppOptions): SecurityOptions {
  const mode = options.authMode ?? 'mock';
  const base: SecurityOptions = {
    authMode: mode,
    sessionStore: 'memory',
    authBaseUrl: process.env.AUTH_BASE_URL ?? 'http://localhost:4001',
    authIssuer: process.env.AUTH_ISSUER ?? 'http://localhost:4001',
    jwtAudience: process.env.JWT_AUDIENCE ?? 'payment-api',
    oauthClientId: process.env.OAUTH_CLIENT_ID ?? 'payment-api',
    oauthClientSecret: process.env.OAUTH_CLIENT_SECRET ?? 'dev-client-secret',
    oauthRedirectUri:
      process.env.OAUTH_REDIRECT_URI ??
      'http://localhost:3001/auth/callback',
    oauthScopes: process.env.OAUTH_SCOPES ?? 'openid profile',
    jwksCacheTtlSec: 300,
    jwtClockToleranceSec: 5,
    syncFreshTtlMs: 300_000,
    syncStaleTtlMs: 1_800_000,
    syncMaxStaleTtlMs: 7_200_000,
    syncBlockingTimeoutMs: 2_000,
    csrfEnabled: options.csrfEnabled !== false,
  };

  if (mode === 'disabled') {
    const du = options.disabledUser ?? DEFAULT_DISABLED_USER;
    return {
      ...base,
      disabledUserId: du.userId,
      disabledUsername: du.username,
      disabledRoleId: du.roleId,
      disabledIsSuperAdmin: du.isSuperAdmin,
      disabledPermissionCodes: du.permissionCodes,
    };
  }

  return base;
}

/**
 * Build a Jest-mocked OAuthClientService with all methods stubbed.
 * Tests configure return values per-scenario (e.g.
 * `mocks.oauthClient.exchangeCode.mockResolvedValue(MOCK_TOKEN_SET_BUDI)`).
 */
function buildMockedOAuthClient(): MockedOAuthClientService {
  return {
    getAuthorizationUrl: jest.fn(),
    exchangeCode: jest.fn(),
    refresh: jest.fn(),
    revoke: jest.fn(),
    fetchPermissions: jest.fn(),
    switchRole: jest.fn(),
  } as unknown as MockedOAuthClientService;
}

/** Build a Jest-mocked JwtVerifier with `verify` + `verifyAuthUser` stubs. */
function buildMockedJwtVerifier(): MockedJwtVerifier {
  return {
    verify: jest.fn(),
    verifyAuthUser: jest.fn(),
  };
}

/**
 * Bootstrap a NestJS app for integration testing.
 *
 * Side effects:
 *   - Sets env vars (`AUTH_MODE`, `AUTH_DISABLED_*`) — restored by `closeTestApp`.
 *   - Initializes TypeORM (SQLite in-memory) — schema auto-created.
 *   - Starts the NestJS app (`app.init()`) — HTTP server is available via
 *     `app.getHttpServer()` for supertest.
 *
 * @param options - Test mode + overrides (see `TestAppOptions`).
 * @returns `TestApp` with `app`, `module`, mock handles, and `sessionStore`.
 */
export async function buildTestApp(
  options: TestAppOptions = {},
): Promise<TestApp> {
  const envSnapshot = snapshotEnv();
  applyEnvForMode(options);

  if (options.csrfEnabled === false) {
    process.env.CSRF_ENABLED = 'false';
  } else {
    // Restore default behavior (CSRF enabled) — leave env unset so Joi
    // applies its default (`true`).
    delete process.env.CSRF_ENABLED;
  }

  const oauthClient = buildMockedOAuthClient();
  const jwtVerifier = buildMockedJwtVerifier();
  const sessionStore = new MemorySessionStore();
  const securityOptions = buildSecurityOptions(options);

  const module: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(OAuthClientService)
    .useValue(oauthClient)
    .overrideProvider(JWT_VERIFIER)
    .useValue(jwtVerifier)
    .overrideProvider(SESSION_STORE)
    .useValue(sessionStore)
    .overrideProvider(SECURITY_OPTIONS)
    .useValue(securityOptions)
    .compile();

  const app = module.createNestApplication();
  app.use(cookieParser());
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      // Don't reject unknown fields — some tests send partial bodies.
      forbidNonWhitelisted: false,
    }),
  );

  await app.init();

  return {
    app,
    module,
    oauthClient,
    jwtVerifier,
    sessionStore,
    envSnapshot,
  };
}

/**
 * Tear down the test app: close the HTTP server, destroy the DI container,
 * and restore env vars to their pre-`buildTestApp` state.
 *
 * Must be called in `afterAll` to prevent env bleed + resource leaks.
 */
export async function closeTestApp(testApp: TestApp): Promise<void> {
  await testApp.app.close();
  for (const [key, value] of Object.entries(testApp.envSnapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

// ---------------------------------------------------------------------------
// CSRF helper
// ---------------------------------------------------------------------------

/** Fixed CSRF token used by tests that need to POST/PUT/DELETE. */
export const TEST_CSRF_TOKEN = 'test-csrf-token-aaaa-bbbb-cccc';

/**
 * Build the Cookie + X-CSRF-Token header values needed to pass CSRF
 * validation in non-disabled AUTH_MODE.
 *
 * Combines the XSRF-TOKEN cookie (read by CsrfMiddleware from `req.cookies`)
 * with any `sid` cookie the caller provides.
 *
 * Usage:
 *   const headers = buildCsrfHeaders(`sid=${sid}`);
 *   await request(app.getHttpServer())
 *     .post('/auth/logout')
 *     .set('Cookie', headers.cookie)
 *     .set('X-CSRF-Token', headers.csrfToken);
 *
 * @param sidCookie - The `sid=...` cookie string (or empty for unauthenticated POSTs).
 * @returns `{ cookie, csrfToken }` ready to attach to a supertest request.
 */
export function buildCsrfHeaders(sidCookie: string = ''): {
  cookie: string;
  csrfToken: string;
} {
  const parts: string[] = [`XSRF-TOKEN=${TEST_CSRF_TOKEN}`];
  if (sidCookie) parts.push(sidCookie);
  return { cookie: parts.join('; '), csrfToken: TEST_CSRF_TOKEN };
}

/**
 * Extract a cookie value from a supertest response's `Set-Cookie` header.
 *
 * @param res - supertest response
 * @param name - cookie name to extract (e.g. 'sid', 'oauth_state')
 * @returns The cookie value, or null if not present
 */
export function getCookieFromResponse(
  res: SupertestResponse,
  name: string,
): string | null {
  const setCookie = res.headers['set-cookie'];
  if (!setCookie) return null;
  const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const raw of cookies) {
    // Format: "name=value; HttpOnly; Path=/; ..."
    const prefix = `${name}=`;
    if (raw.startsWith(prefix)) {
      const endIdx = raw.indexOf(';');
      return endIdx === -1
        ? raw.slice(prefix.length)
        : raw.slice(prefix.length, endIdx);
    }
  }
  return null;
}

// Re-export SessionStore type for tests that need to interact with it.
export type { SessionStore };
