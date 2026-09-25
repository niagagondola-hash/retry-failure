/**
 * MemorySessionStore — sandbox / dev / unit-test session store.
 *
 * Plan reference: PLAN2 Section 9.4.3 (Memory impl), Section 4.4 (Redis vs Memory),
 * Section 8.3 (lock per sesi).
 *
 * - Sessions: `lru-cache` v11 with `max=1000` + default TTL 8h (matches refresh token TTL).
 * - Locks: in-process `Map<string, number>` (key → expiresAt ms epoch).
 *   Cleanup timer purges expired locks every 30s. `unref()` so timer doesn't
 *   block Node.js process exit.
 *
 * Lost on restart — only valid for single-instance deployments (sandbox, dev).
 *
 * All methods are async to satisfy `SessionStore` interface — callers should
 * not assume synchronous return even though MemoryStore returns immediately.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { LRUCache } from 'lru-cache';

import { Session, SessionStore } from './session-store.interface';

export interface MemorySessionStoreOptions {
  /** Max sessions in cache (LRU eviction when exceeded). Default: 1000. */
  max?: number;
  /** Default TTL when caller omits ttlMs (rare — most callers pass ttlMs). Default: 8h. */
  defaultTtlMs?: number;
  /** Lock cleanup interval in ms. Default: 30000 (30s). */
  lockCleanupMs?: number;
}

@Injectable()
export class MemorySessionStore implements SessionStore, OnModuleDestroy {
  private readonly logger = new Logger('MemorySessionStore');
  private readonly sessions: LRUCache<string, Session>;
  private readonly locks = new Map<string, number>(); // key → expiresAt (ms epoch)
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(opts: MemorySessionStoreOptions = {}) {
    const max = opts.max ?? 1000;
    const defaultTtlMs = opts.defaultTtlMs ?? 8 * 60 * 60 * 1000;
    this.sessions = new LRUCache<string, Session>({
      max,
      ttl: defaultTtlMs,
      // `updateAgeOnGet: false` keeps LRU eviction order based on insertion
      // (not access). We refresh TTL explicitly via `touch()` / `updateSync()`.
      updateAgeOnGet: false,
    });

    const intervalMs = opts.lockCleanupMs ?? 30_000;
    this.cleanupTimer = setInterval(() => this.purgeExpiredLocks(), intervalMs);
    // Don't keep Node.js alive just for this timer.
    this.cleanupTimer.unref?.();
  }

  async get(sid: string): Promise<Session | null> {
    const session = this.sessions.get(sid);
    return session ?? null;
  }

  async set(sid: string, session: Session, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) {
      // TTL already expired — drop instead of storing a dead session.
      this.sessions.delete(sid);
      return;
    }
    this.sessions.set(sid, session, { ttl: ttlMs });
  }

  async delete(sid: string): Promise<void> {
    this.sessions.delete(sid);
  }

  async touch(sid: string): Promise<void> {
    const session = this.sessions.get(sid);
    if (!session) return;
    session.lastSeenAt = Date.now();
    const ttl = session.refreshExpiresAt - Date.now();
    if (ttl > 0) {
      this.sessions.set(sid, session, { ttl });
    } else {
      this.sessions.delete(sid);
    }
  }

  async updateSync(
    sid: string,
    permissionCodes: string[],
    lastSyncAt: number,
  ): Promise<void> {
    const session = this.sessions.get(sid);
    if (!session) return;
    session.permissionCodes = permissionCodes;
    session.lastSyncAt = lastSyncAt;
    const ttl = session.refreshExpiresAt - Date.now();
    if (ttl > 0) {
      this.sessions.set(sid, session, { ttl });
    } else {
      this.sessions.delete(sid);
    }
  }

  async listActive(): Promise<Session[]> {
    // LRUCache v11 `.values()` is an IterableIterator<Session>.
    // LRU purges expired entries lazily on access — values() yields
    // non-expired entries (ttl-checked on each iter).
    return Array.from(this.sessions.values());
  }

  /**
   * Acquire in-process lock. Returns `true` iff acquired or previous holder
   * has expired. Atomic via single-threaded JS event loop.
   */
  async acquireLock(key: string, ttlSec: number): Promise<boolean> {
    const now = Date.now();
    const expiresAt = this.locks.get(key);
    if (expiresAt !== undefined && expiresAt > now) {
      return false; // still held
    }
    this.locks.set(key, now + ttlSec * 1000);
    return true;
  }

  async releaseLock(key: string): Promise<void> {
    this.locks.delete(key);
  }

  onModuleDestroy(): void {
    clearInterval(this.cleanupTimer);
    this.sessions.clear();
    this.locks.clear();
    this.logger.log('MemorySessionStore cleared');
  }

  /** Purge expired locks — called by cleanup timer. */
  private purgeExpiredLocks(): void {
    const now = Date.now();
    let purged = 0;
    for (const [key, expiresAt] of this.locks.entries()) {
      if (expiresAt <= now) {
        this.locks.delete(key);
        purged++;
      }
    }
    if (purged > 0) {
      this.logger.debug(`Purged ${purged} expired lock(s)`);
    }
  }
}
