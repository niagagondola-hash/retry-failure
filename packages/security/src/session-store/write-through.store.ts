/**
 * WriteThroughSessionStore — Redis primary + DB audit (AUTH-11a mode 3).
 *
 * Plan reference: AUTH-11a task spec §3, PLAN2 §9.4.
 *
 * Write-through pattern:
 *   - Write: dual-write (Redis + DB) — Redis primary, DB audit
 *   - Read: Redis first → miss → DB fallback → cache to Redis
 *   - Redis down: DB fallback (resilient)
 *
 * Used when SESSION_STORE=redis + SESSION_AUDIT=true.
 */
import { Logger } from '@nestjs/common';

import { PostgresSessionStore } from './postgres.store';
import { RedisSessionStore } from './redis-session.store';
import { Session, SessionStore } from './session-store.interface';

export class WriteThroughSessionStore implements SessionStore {
  private readonly logger = new Logger('WriteThroughSessionStore');

  constructor(
    private readonly redis: RedisSessionStore,
    private readonly db: PostgresSessionStore,
  ) {}

  async get(sid: string): Promise<Session | null> {
    // 1. Try Redis first (fast)
    try {
      const session = await this.redis.get(sid);
      if (session) return session;
    } catch (err) {
      this.logger.warn(`Redis GET failed sid=${sid.substring(0, 8)}...: ${(err as Error).message} — falling back to DB`);
    }

    // 2. Redis miss or down → try DB
    const dbSession = await this.db.get(sid);
    if (!dbSession) return null;

    // 3. Cache to Redis for next read (best-effort, don't fail if Redis still down)
    try {
      const ttlMs = dbSession.refreshExpiresAt - Date.now();
      if (ttlMs > 0) {
        await this.redis.set(sid, dbSession, ttlMs);
      }
    } catch (err) {
      this.logger.warn(`Redis SET (cache warming) failed: ${(err as Error).message} — DB session still returned`);
    }

    return dbSession;
  }

  async set(sid: string, session: Session, ttlMs: number): Promise<void> {
    // 1. Write to Redis (primary)
    try {
      await this.redis.set(sid, session, ttlMs);
    } catch (err) {
      this.logger.warn(`Redis SET failed sid=${sid.substring(0, 8)}...: ${(err as Error).message} — DB write continues`);
    }

    // 2. Write to DB (audit + persistence)
    await this.db.set(sid, session, ttlMs);
  }

  async delete(sid: string): Promise<void> {
    // 1. Delete from Redis (primary)
    try {
      await this.redis.delete(sid);
    } catch (err) {
      this.logger.warn(`Redis DELETE failed sid=${sid.substring(0, 8)}...: ${(err as Error).message} — DB delete continues`);
    }

    // 2. Delete from DB (audit)
    await this.db.delete(sid);
  }

  async touch(sid: string): Promise<void> {
    // 1. Touch Redis (primary)
    try {
      await this.redis.touch(sid);
    } catch (err) {
      this.logger.warn(`Redis TOUCH failed sid=${sid.substring(0, 8)}...: ${(err as Error).message}`);
    }

    // 2. Touch DB (audit)
    await this.db.touch(sid);
  }

  async updateSync(sid: string, permissionCodes: string[], lastSyncAt: number): Promise<void> {
    // 1. Update Redis (primary)
    try {
      await this.redis.updateSync(sid, permissionCodes, lastSyncAt);
    } catch (err) {
      this.logger.warn(`Redis updateSync failed sid=${sid.substring(0, 8)}...: ${(err as Error).message}`);
    }

    // 2. Update DB (audit)
    await this.db.updateSync(sid, permissionCodes, lastSyncAt);
  }

  async listActive(): Promise<Session[]> {
    // DB is authoritative source for active sessions
    return this.db.listActive();
  }

  async acquireLock(key: string, ttlSec: number): Promise<boolean> {
    // Delegate to Redis (distributed lock)
    try {
      return await this.redis.acquireLock(key, ttlSec);
    } catch (err) {
      this.logger.warn(`Redis acquireLock failed: ${(err as Error).message} — lock not acquired`);
      return false;
    }
  }

  async releaseLock(key: string): Promise<void> {
    try {
      await this.redis.releaseLock(key);
    } catch (err) {
      this.logger.warn(`Redis releaseLock failed: ${(err as Error).message}`);
    }
  }
}
