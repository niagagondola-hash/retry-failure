/**
 * RedisSessionStore — production / staging session store backed by Redis.
 *
 * Plan reference: PLAN2 Section 9.4.2 (Redis impl), Section 8.3 (lock per sesi),
 * Section 4.4 (Redis vs Memory).
 *
 * Key layout:
 *  - Session: `session:<sid>` → JSON.stringify(Session) with `PX ttlMs`
 *  - Lock:    `lock:<key>`    → `1` with `NX EX ttlSec` (atomic acquisition)
 *
 * Uses SCAN (cursor-based, non-blocking) for `listActive` to be production-safe
 * (KEYS blocks the Redis event loop on large datasets).
 *
 * Error events from ioredis are logged but do NOT crash the process —
 * payment-api continues serving cached data / re-issues store ops on retry.
 */
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

import { Session, SessionStore } from './session-store.interface';

@Injectable()
export class RedisSessionStore implements SessionStore, OnModuleDestroy {
  private readonly logger = new Logger('RedisSessionStore');
  private readonly redis: Redis;
  private readonly prefix = 'session:';
  private readonly lockPrefix = 'lock:';

  constructor(redisUrl: string) {
    this.redis = new Redis(redisUrl, {
      lazyConnect: false,
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
    });
    this.redis.on('error', (err: Error) => {
      this.logger.error(`Redis error: ${err.message}`);
    });
    this.redis.on('connect', () => {
      this.logger.log(`Redis connected: ${this.maskUrl(redisUrl)}`);
    });
  }

  /** Mask credentials in URL for logging. */
  private maskUrl(url: string): string {
    return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@');
  }

  private key(sid: string): string {
    return `${this.prefix}${sid}`;
  }

  private lockKey(key: string): string {
    return `${this.lockPrefix}${key}`;
  }

  async get(sid: string): Promise<Session | null> {
    const raw = await this.redis.get(this.key(sid));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as Session;
    } catch (err) {
      this.logger.error(`Failed to parse session ${sid}: ${(err as Error).message}`);
      return null;
    }
  }

  async set(sid: string, session: Session, ttlMs: number): Promise<void> {
    if (ttlMs <= 0) {
      // TTL already expired — delete instead of storing a dead session.
      await this.redis.del(this.key(sid));
      return;
    }
    await this.redis.set(this.key(sid), JSON.stringify(session), 'PX', ttlMs);
  }

  async delete(sid: string): Promise<void> {
    await this.redis.del(this.key(sid));
  }

  async touch(sid: string): Promise<void> {
    const session = await this.get(sid);
    if (!session) return;
    session.lastSeenAt = Date.now();
    const ttl = session.refreshExpiresAt - Date.now();
    if (ttl > 0) {
      await this.set(sid, session, ttl);
    } else {
      // Already expired — let Redis clean it up.
      await this.redis.del(this.key(sid));
    }
  }

  async updateSync(
    sid: string,
    permissionCodes: string[],
    lastSyncAt: number,
  ): Promise<void> {
    const session = await this.get(sid);
    if (!session) return;
    session.permissionCodes = permissionCodes;
    session.lastSyncAt = lastSyncAt;
    const ttl = session.refreshExpiresAt - Date.now();
    if (ttl > 0) {
      await this.set(sid, session, ttl);
    } else {
      await this.redis.del(this.key(sid));
    }
  }

  async listActive(): Promise<Session[]> {
    const sessions: Session[] = [];
    let cursor = '0';
    do {
      const [next, keys] = await this.redis.scan(
        cursor,
        'MATCH',
        `${this.prefix}*`,
        'COUNT',
        100,
      );
      cursor = next;
      if (keys.length === 0) continue;
      const values = await this.redis.mget(...keys);
      for (const v of values) {
        if (!v) continue;
        try {
          sessions.push(JSON.parse(v) as Session);
        } catch {
          // Skip malformed entries — they will be reaped by Redis TTL.
        }
      }
    } while (cursor !== '0');
    return sessions;
  }

  /**
   * Acquire lock — `SET lock:<key> 1 NX EX ttlSec` (atomic).
   * Returns true iff `result === 'OK'`.
   */
  async acquireLock(key: string, ttlSec: number): Promise<boolean> {
    const result = await this.redis.set(
      this.lockKey(key),
      '1',
      'EX',
      ttlSec,
      'NX',
    );
    return result === 'OK';
  }

  async releaseLock(key: string): Promise<void> {
    await this.redis.del(this.lockKey(key));
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.redis.quit();
      this.logger.log('Redis connection closed');
    } catch (err) {
      this.logger.warn(`Error closing Redis: ${(err as Error).message}`);
    }
  }
}
