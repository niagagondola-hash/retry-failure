/**
 * Test session helper — seed sessions directly in the in-memory SessionStore.
 *
 * Plan reference: PLAN2 Section 17.2 (Integration tests), Section 9.4
 * (SessionStore), AUTH-25 task spec §4 (test-session.ts).
 *
 * Used by integration tests to bypass the OAuth flow + create a session
 * directly via `MemorySessionStore.set(sid, session, ttlMs)`. This lets
 * tests of protected endpoints focus on auth/permission behavior without
 * repeating the OAuth callback dance.
 *
 * For tests that need to verify the full OAuth flow (e.g. /auth/callback),
 * use the OAuthClientService mock + supertest instead of this helper.
 */
import { randomBytes } from 'node:crypto';

import {
  CacheRepository,
  MemorySessionStore,
  Session,
  SessionService,
} from '@retry-failure/security';
import type { INestApplication } from '@nestjs/common';

/** Session TTL — 8 hours (matches refresh token TTL per plan2 §5.3). */
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

/** Input for `createTestSession` — overrides default session fields. */
export interface CreateTestSessionInput {
  /** User ID — defaults to Budi (mock fixture). */
  userId?: string;
  /** Username — defaults to 'budi_santoso'. */
  username?: string;
  /** Role ID — defaults to HRD role (mock fixture). */
  roleId?: string;
  /** Permission codes — defaults to HRD permission set. */
  permissionCodes?: string[];
  /** Access token — defaults to a mock string. */
  accessToken?: string;
  /** Refresh token — defaults to a mock string. */
  refreshToken?: string;
  /** Access token expiry (Unix ms) — defaults to now + 15min. */
  accessExpiresAt?: number;
  /** Refresh token expiry (Unix ms) — defaults to now + 8h. */
  refreshExpiresAt?: number;
}

/** Default values match `MOCK_USER_BUDI` + `MOCK_ROLE_HRD` from fixtures. */
const DEFAULT_SESSION: Required<CreateTestSessionInput> = {
  userId: '00000000-0000-1000-8000-000000000001',
  username: 'budi_santoso',
  roleId: '00000000-0000-1000-8000-000000000010',
  permissionCodes: ['dashboard', 'payment.read', 'payment.write'],
  accessToken: 'mock-access-budi',
  refreshToken: 'mock-refresh-budi',
  accessExpiresAt: Date.now() + 15 * 60 * 1000,
  refreshExpiresAt: Date.now() + SESSION_TTL_MS,
};

/**
 * Generate a random 64-char hex session ID (matches SessionService.create
 * behavior — `randomBytes(32).toString('hex')`).
 */
function generateSid(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Build a `Session` record from the given input + defaults.
 * Side effects: none — caller is responsible for persisting via `store.set`.
 */
function buildSession(input: CreateTestSessionInput, sid: string): Session {
  const merged = { ...DEFAULT_SESSION, ...input };
  const now = Date.now();
  return {
    sid,
    userId: merged.userId,
    username: merged.username,
    roleId: merged.roleId,
    permissionCodes: merged.permissionCodes,
    accessToken: merged.accessToken,
    refreshToken: merged.refreshToken,
    accessExpiresAt: merged.accessExpiresAt,
    refreshExpiresAt: merged.refreshExpiresAt,
    createdAt: now,
    lastSeenAt: now,
    lastSyncAt: now,
  };
}

/**
 * Create a test session directly in the in-memory SessionStore.
 *
 * Bypasses the OAuth flow + SessionService.create so tests of protected
 * endpoints can run without mocking the full callback dance.
 *
 * @param store - The `MemorySessionStore` from `TestApp.sessionStore`.
 * @param overrides - Optional overrides for userId, roleId, permissionCodes, etc.
 * @returns `{ sid, cookie }` where `cookie` is a `sid=...` string ready
 *          to attach to supertest requests via `.set('Cookie', cookie)`.
 */
export async function createTestSession(
  store: MemorySessionStore,
  overrides: CreateTestSessionInput = {},
): Promise<{ sid: string; cookie: string }> {
  const sid = generateSid();
  const session = buildSession(overrides, sid);
  const ttlMs = session.refreshExpiresAt - Date.now();
  await store.set(sid, session, ttlMs);
  return { sid, cookie: `sid=${sid}` };
}

/**
 * Variant that uses the real `SessionService.create` (which sets sid,
 * persists, and logs). Use this when you want to verify SessionService
 * integration with the store, not just seed a session.
 *
 * @param app - NestJS app to resolve `SessionService` from.
 * @param input - User + tokens to seed the session with.
 * @returns `{ sid, cookie }` ready for supertest.
 */
export async function createTestSessionViaService(
  app: INestApplication,
  input: CreateTestSessionInput & { tokens?: { accessToken: string; refreshToken: string; expiresAt: number; tokenType: 'Bearer'; scope?: string } },
): Promise<{ sid: string; cookie: string }> {
  const sessionService = app.get(SessionService);
  const merged = { ...DEFAULT_SESSION, ...input };
  const tokens = input.tokens ?? {
    accessToken: merged.accessToken,
    refreshToken: merged.refreshToken,
    expiresAt: Math.floor(merged.accessExpiresAt / 1000),
    tokenType: 'Bearer' as const,
    scope: 'openid profile',
  };
  const { sid } = await sessionService.create({
    userId: merged.userId,
    username: merged.username,
    roleId: merged.roleId,
    permissionCodes: merged.permissionCodes,
    tokens,
  });
  return { sid, cookie: `sid=${sid}` };
}

/**
 * Seed the cached_users table with a user record (for isSuperAdmin lookup).
 *
 * `SessionGuard` reads `cached_users.is_super_admin` to set `req.user.isSuperAdmin`.
 * For tests that need `isSuperAdmin=true` (e.g. bypass test), seed the cache
 * before making the request.
 *
 * @param app - NestJS app to resolve `CacheRepository` from.
 * @param user - `{ userId, username, name, isSuperAdmin }`.
 */
export async function seedCachedUser(
  app: INestApplication,
  user: {
    userId: string;
    username: string;
    name: string;
    email?: string | null;
    isSuperAdmin: boolean;
  },
): Promise<void> {
  const cacheRepo = app.get(CacheRepository);
  await cacheRepo.upsertCachedUser({
    user_id: user.userId,
    username: user.username,
    email: user.email ?? null,
    name: user.name,
    is_super_admin: user.isSuperAdmin,
  });
}
