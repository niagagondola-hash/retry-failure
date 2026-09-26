/**
 * LazySyncMiddleware — stale-while-revalidate sync for sessions (AUTH-14).
 *
 * Plan reference: PLAN2 Section 8.2 (alur lazy sync), Section 8.3 (lock per sesi),
 * Section 8.7 (grace period), Section 16 (SYNC_* env vars).
 *
 * Runs BEFORE `SessionGuard` (per plan2 §8.4) so the session's
 * `permissionCodes` are fresh when `MenuAccessGuard` checks them.
 *
 * 4-tier SWR flow (per `age = Date.now() - session.lastSyncAt`):
 *   1. `age < FRESH_TTL (5 min)`        → fresh, no sync, `next()`.
 *   2. `FRESH ≤ age < STALE_TTL (30m)`  → background sync (non-blocking) + `next()`.
 *   3. `STALE ≤ age < MAX_STALE_TTL (2h)`→ blocking sync (timeout 2s) + `next()`.
 *   4. `age ≥ MAX_STALE_TTL (2h)`        → invalidate session (delete + next, SessionGuard 401).
 *
 * Background sync is fire-and-forget via `setImmediate` — errors are caught
 * and logged (do NOT propagate, do NOT block `next()`).
 *
 * Blocking sync wraps `doSync` in `withTimeout(..., SYNC_BLOCKING_TIMEOUT_MS)`.
 * On timeout/error → log warning + `next()` (use stale cache).
 *
 * `doSync` acquires a per-session lock (`SyncLockService.acquireLock`) so only
 * one concurrent request triggers an auth API call; lock is released in a
 * `finally` block so it survives sync errors.
 *
 * `AUTH_MODE=disabled` → middleware skips entirely (no session lookup, no sync).
 */
import {
  Inject,
  Injectable,
  Logger,
  NestMiddleware,
} from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { parseSessionCookie } from '../oauth/cookie.util';
import { SECURITY_OPTIONS } from '../oauth/oauth-client.service';
import type { SecurityOptions } from '../security.module';
import {
  SESSION_STORE,
  Session,
  SessionStore,
} from '../session-store';
import { AuthSyncService } from '../sync/auth-sync.service';
import { SyncLockService } from '../sync/sync-lock.service';
import { withTimeout } from '../sync/with-timeout.util';

/** Default TTLs per plan2 §16 — overridden by `SecurityOptions.sync*`. */
const DEFAULT_FRESH_TTL_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_STALE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_STALE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_BLOCKING_TIMEOUT_MS = 2_000; // 2 seconds

@Injectable()
export class LazySyncMiddleware implements NestMiddleware {
  private readonly logger = new Logger('LazySyncMiddleware');
  private readonly freshTtlMs: number;
  private readonly staleTtlMs: number;
  private readonly maxStaleTtlMs: number;
  private readonly blockingTimeoutMs: number;
  private readonly lockTtlSec: number;
  private readonly authMode: SecurityOptions['authMode'];

  constructor(
    @Inject(SESSION_STORE) private readonly store: SessionStore,
    private readonly syncService: AuthSyncService,
    private readonly lockService: SyncLockService,
    @Inject(SECURITY_OPTIONS) options: SecurityOptions,
  ) {
    this.freshTtlMs = options.syncFreshTtlMs ?? DEFAULT_FRESH_TTL_MS;
    this.staleTtlMs = options.syncStaleTtlMs ?? DEFAULT_STALE_TTL_MS;
    this.maxStaleTtlMs = options.syncMaxStaleTtlMs ?? DEFAULT_MAX_STALE_TTL_MS;
    this.blockingTimeoutMs =
      options.syncBlockingTimeoutMs ?? DEFAULT_BLOCKING_TIMEOUT_MS;
    this.lockTtlSec = options.syncLockTtlSec ?? 10;
    this.authMode = options.authMode;
  }

  /**
   * Run the 4-tier SWR flow for the incoming request.
   *
   * Reads `sid` cookie → looks up session → branches on `age` (see class doc).
   * Always calls `next()` — never sends an HTTP response directly (SessionGuard
   * owns 401/403).
   */
  async use(req: Request, _res: Response, next: NextFunction): Promise<void> {
    // 0. AUTH_MODE=disabled → skip entirely
    if (this.authMode === 'disabled') {
      return next();
    }

    // 1. Read `sid` cookie (cookie-parser middleware or manual fallback)
    const sid = parseSessionCookie(req);
    if (!sid) return next();

    // 2. Lookup session
    const session = await this.store.get(sid);
    if (!session) return next(); // SessionGuard will handle 401

    const age = Date.now() - session.lastSyncAt;

    // 3. Max stale → invalidate session (force re-login on next SessionGuard)
    if (age >= this.maxStaleTtlMs) {
      this.logger.warn(
        `Session sid=${sid.substring(0, 8)}... exceeded MAX_STALE_TTL (${this.maxStaleTtlMs}ms) — invalidating`,
      );
      await this.store.delete(sid);
      return next();
    }

    // 4. Fresh → no sync needed
    if (age < this.freshTtlMs) {
      return next();
    }

    // 5. Stale (5-30 min) → background sync (non-blocking)
    if (age < this.staleTtlMs) {
      this.triggerBackgroundSync(session);
      return next();
    }

    // 6. Very stale (30 min - 2h) → blocking sync with timeout, fall back to stale
    try {
      await withTimeout(
        this.doSync(session),
        this.blockingTimeoutMs,
        'sync blocking',
      );
    } catch (err) {
      this.logger.warn(
        `Blocking sync failed sid=${sid.substring(0, 8)}...: ${(err as Error).message} — using stale cache`,
      );
    }
    return next();
  }

  /**
   * Fire-and-forget background sync via `setImmediate`.
   * Errors are caught + logged — do NOT propagate to the request lifecycle
   * (background sync must never break the user's request).
   */
  private triggerBackgroundSync(session: Session): void {
    const sidShort = session.sid.substring(0, 8);
    setImmediate(async () => {
      try {
        await this.doSync(session);
      } catch (err) {
        this.logger.warn(
          `Background sync failed sid=${sidShort}...: ${(err as Error).message}`,
        );
      }
    });
  }

  /**
   * Acquire per-session lock → sync → release lock in `finally`.
   * If lock is already held by another concurrent request, skip sync (the
   * other holder is already fetching fresh permissions).
   */
  private async doSync(session: Session): Promise<void> {
    const sidShort = session.sid.substring(0, 8);
    const acquired = await this.lockService.acquireLock(
      session.sid,
      this.lockTtlSec,
    );
    if (!acquired) {
      this.logger.debug(
        `Lock held by another process sid=${sidShort}... — skip sync`,
      );
      return;
    }
    try {
      await this.syncService.syncSession(session);
    } finally {
      await this.lockService.releaseLock(session.sid);
    }
  }
}
