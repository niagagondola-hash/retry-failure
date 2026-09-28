/**
 * PostgresSessionStore — SessionStore backed by DB sessions table (AUTH-11a mode 2).
 *
 * Plan reference: AUTH-11a task spec §2, PLAN2 §7.2 (sessions table),
 * §9.4.1 (SessionStore interface).
 *
 * For teams without Redis: sessions stored directly in DB.
 * Persistent across restarts, but slower than Redis (~5-10ms vs 0.1ms).
 *
 * Lock mechanism: in-process Map with TTL (single-instance only).
 * Multi-instance with DB-only mode is NOT supported — upgrade to Redis.
 *
 * Works with both SQLite (synchronize mode) and PostgreSQL (migrations).
 */
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';

import { CachedUser } from '../cache/cached-user.entity';
import { SessionEntity } from '../cache/session.entity';

import { Session, SessionStore } from './session-store.interface';

/** Lock entry for in-process lock Map. */
interface LockEntry {
  expiresAt: number;
}

export class PostgresSessionStore implements SessionStore {
  private readonly logger = new Logger('PostgresSessionStore');
  private readonly locks = new Map<string, LockEntry>();
  private readonly lockTimers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly repo: Repository<SessionEntity>,
    private readonly userRepo?: Repository<CachedUser>,
  ) {}

  async get(sid: string): Promise<Session | null> {
    const entity = await this.repo.findOne({ where: { sid } });
    if (!entity) return null;

    // Check expired
    if (entity.refresh_expires_at && new Date(entity.refresh_expires_at).getTime() < Date.now()) {
      await this.repo.delete({ sid });
      return null;
    }

    return this.entityToSession(entity);
  }

  async set(sid: string, session: Session, _ttlMs: number): Promise<void> {
    const existing = await this.repo.findOne({ where: { sid } });

    if (existing) {
      existing.user_id = session.userId;
      existing.role_id = session.roleId;
      existing.permission_codes = session.permissionCodes;
      existing.access_token = session.accessToken;
      existing.refresh_token = session.refreshToken;
      existing.access_expires_at = session.accessExpiresAt ? new Date(session.accessExpiresAt) : null;
      existing.refresh_expires_at = session.refreshExpiresAt ? new Date(session.refreshExpiresAt) : null;
      existing.last_seen_at = new Date(session.lastSeenAt);
      existing.last_sync_at = new Date(session.lastSyncAt);
      await this.repo.save(existing);
    } else {
      const entity = this.repo.create({
        sid,
        user_id: session.userId,
        role_id: session.roleId,
        permission_codes: session.permissionCodes,
        access_token: session.accessToken,
        refresh_token: session.refreshToken,
        access_expires_at: session.accessExpiresAt ? new Date(session.accessExpiresAt) : null,
        refresh_expires_at: session.refreshExpiresAt ? new Date(session.refreshExpiresAt) : null,
        created_at: new Date(session.createdAt),
        last_seen_at: new Date(session.lastSeenAt),
        last_sync_at: new Date(session.lastSyncAt),
      });
      await this.repo.save(entity);
    }
  }

  async delete(sid: string): Promise<void> {
    await this.repo.delete({ sid });
  }

  async touch(sid: string): Promise<void> {
    await this.repo.update({ sid }, { last_seen_at: new Date() });
  }

  async updateSync(sid: string, permissionCodes: string[], lastSyncAt: number): Promise<void> {
    await this.repo.update(
      { sid },
      {
        permission_codes: permissionCodes,
        last_sync_at: new Date(lastSyncAt),
      },
    );
  }

  async listActive(): Promise<Session[]> {
    const now = new Date();
    const entities = await this.repo
      .createQueryBuilder('s')
      .where('s.refresh_expires_at > :now', { now })
      .getMany();
    const sessions: Session[] = [];
    for (const e of entities) {
      const s = await this.entityToSession(e);
      if (s) sessions.push(s);
    }
    return sessions;
  }

  async acquireLock(key: string, ttlSec: number): Promise<boolean> {
    const existing = this.locks.get(key);
    if (existing && existing.expiresAt > Date.now()) {
      return false; // Still held
    }

    const expiresAt = Date.now() + ttlSec * 1000;
    this.locks.set(key, { expiresAt });

    const timer = setTimeout(() => {
      this.locks.delete(key);
      this.lockTimers.delete(timer);
    }, ttlSec * 1000);
    timer.unref?.();
    this.lockTimers.add(timer);

    return true;
  }

  async releaseLock(key: string): Promise<void> {
    this.locks.delete(key);
  }

  /**
   * Convert SessionEntity → Session domain object.
   *
   * Username is NOT stored in sessions table (DRY — it's in cached_users).
   * If userRepo is available, lookup cached_users for username.
   * If not, username is empty string (caller should merge from cached_users).
   */
  private async entityToSession(entity: SessionEntity): Promise<Session | null> {
    if (!entity) return null;

    // Lookup username from cached_users (DRY — username not duplicated in sessions)
    let username = '';
    if (this.userRepo) {
      const cached = await this.userRepo.findOne({ where: { user_id: entity.user_id } });
      if (cached) {
        username = cached.username;
      }
    }

    return {
      sid: entity.sid,
      userId: entity.user_id,
      username,
      roleId: entity.role_id,
      permissionCodes: entity.permission_codes ?? [],
      accessToken: entity.access_token ?? '',
      refreshToken: entity.refresh_token ?? '',
      accessExpiresAt: toTimestamp(entity.access_expires_at, 0),
      refreshExpiresAt: toTimestamp(entity.refresh_expires_at, 0),
      createdAt: toTimestamp(entity.created_at, Date.now()),
      lastSeenAt: toTimestamp(entity.last_seen_at, Date.now()),
      lastSyncAt: toTimestamp(entity.last_sync_at, Date.now()),
    };
  }
}

/**
 * Convert a nullable DB timestamp value to epoch milliseconds.
 *
 * Extracted from `entityToSession()` to reduce cyclomatic complexity (each
 * `entity.X ? new Date(...).getTime() : fallback` was a branch — 5 of them
 * pushed the method past the warn threshold). Single-responsibility helper
 * that's easy to test in isolation.
 *
 * Accepts `Date | string | null | undefined` because TypeORM may materialize
 * timestamp columns either as `Date` instances (PostgreSQL native) or as
 * ISO strings (SQLite fallback in tests).
 */
function toTimestamp(value: Date | string | null | undefined, fallback: number): number {
  if (!value) return fallback;
  const ms = typeof value === 'number' ? value : new Date(value).getTime();
  return Number.isNaN(ms) ? fallback : ms;
}
