/**
 * SyncLockService — distributed lock wrapper for per-session sync (AUTH-14).
 *
 * Plan reference: PLAN2 Section 8.3 (lock per sesi), Section 16 (SYNC_LOCK_TTL_SEC).
 *
 * Single Responsibility: acquire + release a per-session lock to prevent
 * thundering-herd sync calls when multiple concurrent requests for the same
 * session all observe a stale `lastSyncAt`. The lock key is scoped per sid:
 *
 *   `sync:lock:<sid>`
 *
 * Underlying atomic semantics are delegated to `SessionStore.acquireLock` /
 * `SessionStore.releaseLock`:
 *   - Redis implementation: `SET NX EX <ttlSec>` (atomic).
 *   - Memory implementation: `Map<string, number>` with expiresAt timestamp.
 *
 * The lock TTL (default 10s) bounds how long a holder can keep the lock — if
 * the holder crashes mid-sync, the lock auto-expires so the next request can
 * retry. Callers MUST release the lock in a `finally` block (see `LazySyncMiddleware.doSync`).
 */
import { Inject, Injectable, Logger } from '@nestjs/common';

import {
  SESSION_STORE,
  SessionStore,
} from '../session-store';

/** Default lock TTL (seconds) — matches plan2 §16 SYNC_LOCK_TTL_SEC. */
export const DEFAULT_SYNC_LOCK_TTL_SEC = 10;

@Injectable()
export class SyncLockService {
  private readonly logger = new Logger('SyncLockService');

  constructor(
    @Inject(SESSION_STORE) private readonly store: SessionStore,
  ) {}

  /**
   * Try to acquire the per-session sync lock.
   *
   * @param sid - session ID (lock key = `sync:lock:<sid>`)
   * @param ttlSec - lock TTL in seconds (default 10s)
   * @returns `true` if acquired, `false` if already held by another holder
   */
  async acquireLock(
    sid: string,
    ttlSec: number = DEFAULT_SYNC_LOCK_TTL_SEC,
  ): Promise<boolean> {
    const key = `sync:lock:${sid}`;
    const acquired = await this.store.acquireLock(key, ttlSec);
    if (acquired) {
      this.logger.debug(
        `Acquired lock sid=${sid.substring(0, 8)}... ttl=${ttlSec}s`,
      );
    }
    return acquired;
  }

  /**
   * Release the per-session sync lock. Idempotent — safe to call even if the
   * lock was never acquired or already expired.
   *
   * @param sid - session ID (lock key = `sync:lock:<sid>`)
   */
  async releaseLock(sid: string): Promise<void> {
    const key = `sync:lock:${sid}`;
    await this.store.releaseLock(key);
  }
}
