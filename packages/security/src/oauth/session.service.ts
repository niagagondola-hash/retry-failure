/**
 * SessionService — high-level session management (AUTH-12).
 *
 * Plan reference: PLAN2 Section 9.4 (session store), Section 5.3 (token TTL),
 * Section 5.6 (switch-role), AUTH-12 task spec §2.
 *
 * Wraps `SessionStore` (Redis/memory) with business logic for:
 *   - Session creation (random `sid` + populate from token set)
 *   - Session lookup (by `sid`)
 *   - Session deletion (logout)
 *   - Session touch (rolling TTL on activity)
 *   - Sync update (after lazy sync refreshes permissions)
 *   - Switch-role update (update session in-place with new tokens + role)
 *
 * Single Responsibility: session lifecycle management only.
 * Persistence concerns delegated to `SessionStore`.
 * Cookie concerns delegated to `cookie.util.ts`.
 */
import { randomBytes } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { Session, SessionStore, SESSION_STORE } from '../session-store';

import type { TokenSet } from './oauth-client.types';

/** Input shape for creating a new session. */
export interface CreateSessionInput {
  userId: string;
  username: string;
  roleId: string;
  permissionCodes: string[];
  tokens: TokenSet;
}

/** Refresh token TTL — 8 hours absolute per plan2 §5.3. */
const REFRESH_TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

@Injectable()
export class SessionService {
  private readonly logger = new Logger('SessionService');

  constructor(
    @Inject(SESSION_STORE) private readonly store: SessionStore,
  ) {}

  /**
   * Create a new session with random `sid` (64-char hex).
   *
   * Session TTL = `refreshExpiresAt - now` (session expires when refresh token expires).
   *
   * @param input - User + tokens to seed session
   * @returns Object with `sid` (cookie value) + `session` (full record)
   */
  async create(
    input: CreateSessionInput,
  ): Promise<{ sid: string; session: Session }> {
    const sid = randomBytes(32).toString('hex');
    const now = Date.now();

    const session: Session = {
      sid,
      userId: input.userId,
      username: input.username,
      roleId: input.roleId,
      permissionCodes: input.permissionCodes,
      idToken: input.tokens.idToken ?? '',
      accessToken: input.tokens.accessToken,
      refreshToken: input.tokens.refreshToken ?? '',
      // Convert seconds → ms (plan2 §5.3: expiresAt is Unix seconds)
      accessExpiresAt: input.tokens.expiresAt * 1000,
      // 8h absolute from now
      refreshExpiresAt: now + REFRESH_TOKEN_TTL_MS,
      createdAt: now,
      lastSeenAt: now,
      // Initial sync = now (just fetched during OAuth callback)
      lastSyncAt: now,
    };

    const ttlMs = session.refreshExpiresAt - now;
    await this.store.set(sid, session, ttlMs);
    this.logger.log(
      `Created session sid=${sid.substring(0, 8)}... userId=${input.userId}`,
    );
    return { sid, session };
  }

  /** Lookup session by sid. Returns null if not found / expired. */
  async get(sid: string): Promise<Session | null> {
    return this.store.get(sid);
  }

  /** Delete session (logout / cleanup). Delegates to store + logs. */
  async delete(sid: string): Promise<void> {
    await this.store.delete(sid);
    this.logger.log(`Deleted session sid=${sid.substring(0, 8)}...`);
  }

  /** Touch session — update lastSeenAt + refresh TTL (rolling session). */
  async touch(sid: string): Promise<void> {
    await this.store.touch(sid);
  }

  /**
   * Update sync info — after lazy sync refreshes permission codes.
   * Sets `lastSyncAt = Date.now()`.
   */
  async updateSync(sid: string, permissionCodes: string[]): Promise<void> {
    await this.store.updateSync(sid, permissionCodes, Date.now());
  }

  /**
   * Update session in-place after switch-role (plan2 §5.6).
   *
   * Updates: roleId, accessToken, refreshToken, accessExpiresAt, permissionCodes,
   * lastSyncAt. Persists to store with refreshed TTL.
   *
   * @returns Updated session, or null if session no longer exists
   */
  async updateOnSwitchRole(
    sid: string,
    newRoleId: string,
    newTokens: TokenSet,
    newPermissionCodes: string[],
  ): Promise<Session | null> {
    const session = await this.store.get(sid);
    if (!session) return null;

    session.roleId = newRoleId;
    session.accessToken = newTokens.accessToken;
    session.refreshToken = newTokens.refreshToken ?? session.refreshToken;
    session.accessExpiresAt = newTokens.expiresAt * 1000;
    session.permissionCodes = newPermissionCodes;
    session.lastSyncAt = Date.now();

    const ttlMs = session.refreshExpiresAt - Date.now();
    if (ttlMs > 0) {
      await this.store.set(sid, session, ttlMs);
    }
    return session;
  }

  /**
   * Update session tokens after token refresh (AUTH-09b).
   *
   * Updates: accessToken, refreshToken, accessExpiresAt, idToken, lastSyncAt.
   * Persists to store with refreshed TTL.
   *
   * @returns Updated session, or null if session no longer exists
   */
  async updateTokens(sid: string, tokens: TokenSet): Promise<Session | null> {
    const session = await this.store.get(sid);
    if (!session) return null;

    session.accessToken = tokens.accessToken;
    session.refreshToken = tokens.refreshToken ?? session.refreshToken;
    session.idToken = tokens.idToken ?? session.idToken;
    session.accessExpiresAt = tokens.expiresAt * 1000;
    session.lastSyncAt = Date.now();

    const ttlMs = session.refreshExpiresAt - Date.now();
    if (ttlMs > 0) {
      await this.store.set(sid, session, ttlMs);
    }
    return session;
  }
}
