/**
 * SessionStore — interface + Session shape for Plan2 auth session management.
 *
 * Plan reference: PLAN2 Section 9.4.1 (interface), Section 4.4 (Redis vs Memory),
 * Section 8.3 (lock per sesi).
 *
 * Two implementations:
 *  - `RedisSessionStore` (production, staging, multi-instance — persistence + scaling)
 *  - `MemorySessionStore` (sandbox, dev, unit test — in-process LRU)
 *
 * Both implementations MUST satisfy this interface exactly (parity test
 * in `tests/session-store.parity.spec.ts` catches drift).
 */

/** Session record persisted in store. 11 fields per plan2 §9.4.1. */
export interface Session {
  /** Session ID — opaque random string, also stored in cookie `sid`. */
  sid: string;
  /** Auth user ID (JWT `sub`). */
  userId: string;
  /** Auth username (for display / audit). */
  username: string;
  /** Active role ID (may change on switch-role). */
  roleId: string;
  /** Permission codes for active role (lazy-synced from auth). */
  permissionCodes: string[];
  /** OAuth2 access token (JWT RS256). */
  accessToken: string;
  /** OAuth2 refresh token (rotated on each refresh). */
  refreshToken: string;
  /** Access token expiry — Unix ms epoch. */
  accessExpiresAt: number;
  /** Refresh token expiry — Unix ms epoch (session TTL reference). */
  refreshExpiresAt: number;
  /** Session creation — Unix ms epoch. */
  createdAt: number;
  /** Last request seen — Unix ms epoch (rolling session TTL reference). */
  lastSeenAt: number;
  /** Last permission sync — Unix ms epoch (lazy-sync source-of-truth check). */
  lastSyncAt: number;
}

/** SessionStore — abstract persistence + distributed lock for sessions. */
export interface SessionStore {
  /** Fetch session by sid, or null if not found / expired. */
  get(sid: string): Promise<Session | null>;
  /** Persist session with TTL in milliseconds (TTL = refreshExpiresAt - now). */
  set(sid: string, session: Session, ttlMs: number): Promise<void>;
  /** Delete session (logout / cleanup). */
  delete(sid: string): Promise<void>;
  /** Update `lastSeenAt` and refresh TTL (rolling session). */
  touch(sid: string): Promise<void>;
  /** Update `permissionCodes` + `lastSyncAt` after lazy sync, refresh TTL. */
  updateSync(sid: string, permissionCodes: string[], lastSyncAt: number): Promise<void>;
  /** List all active (non-expired) sessions — for ops / cleanup scheduler. */
  listActive(): Promise<Session[]>;
  /**
   * Acquire a distributed lock for `key`. Returns `true` if acquired,
   * `false` if already held by another holder.
   * Used by lazy-sync middleware to prevent thundering-herd sync (plan2 §8.3).
   */
  acquireLock(key: string, ttlSec: number): Promise<boolean>;
  /** Release the lock for `key`. Idempotent — no-op if not held. */
  releaseLock(key: string): Promise<void>;
}
