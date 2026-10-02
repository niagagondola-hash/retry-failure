/**
 * AuthSessionService — auth-mock's own login session (cookie `auth_sid`).
 *
 * Plan reference: PLAN2 Section 10.7.9 (Session auth — separate from payment-api
 * `sid` cookie).
 *
 * This session is *only* used to remember the user across the multi-step
 * `/oauth/authorize` flow (login → optional select-role → redirect). It is
 * NOT the payment-api session. TTL 1 hour. In-memory Map.
 *
 * Cookie attributes:
 *   - HttpOnly     (no JS access)
 *   - SameSite=Lax (allow top-level cross-site redirect from payment-api)
 *   - Path=/
 *   - Max-Age=3600
 *   - Secure: only when AUTH_MOCK_TLS=on (dev is HTTP)
 */
import { randomBytes } from 'node:crypto';

import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';

import type { MockUser } from '../user/user.service';

export const AUTH_SID_COOKIE = 'auth_sid';
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour per plan2 §10.7.9

export interface AuthSession {
  sid: string;
  userId: string;
  username: string;
  /** Cached user object so subsequent /oauth/authorize skips re-validation. */
  user: MockUser;
  createdAt: number;
  expiresAt: number;
}

@Injectable()
export class AuthSessionService implements OnModuleDestroy {
  private readonly sessions = new Map<string, AuthSession>();
  private readonly timers = new Set<NodeJS.Timeout>();

  /** Create session, set cookie, return the user-facing sid. */
  async create(res: Response, user: MockUser): Promise<string> {
    const sid = randomBytes(32).toString('hex');
    const now = Date.now();
    const session: AuthSession = {
      sid,
      userId: user.id,
      username: user.username,
      user,
      createdAt: now,
      expiresAt: now + SESSION_TTL_MS,
    };
    this.sessions.set(sid, session);

    const t = setTimeout(() => {
      this.sessions.delete(sid);
      this.timers.delete(t);
    }, SESSION_TTL_MS);
    t.unref?.();
    this.timers.add(t);

    res.cookie(AUTH_SID_COOKIE, sid, this.cookieOptions());
    return sid;
  }

  /** Lookup session by reading the cookie from req. Returns null if absent/expired. */
  async get(req: Request): Promise<AuthSession | null> {
    const sid = req.cookies?.[AUTH_SID_COOKIE] as string | undefined;
    if (!sid) return null;
    const session = this.sessions.get(sid);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.sessions.delete(sid);
      return null;
    }
    return session;
  }

  /** Destroy session + clear cookie (logout). */
  async destroy(res: Response, sid?: string): Promise<void> {
    if (sid) this.sessions.delete(sid);
    res.clearCookie(AUTH_SID_COOKIE, this.cookieOptions());
  }

  /**
   * Delete all sessions for a given userId (RP-initiated logout — AUTH-09a).
   *
   * Used by `GET /oauth/logout` when the caller passes `id_token_hint`.
   * The JWT `sub` claim identifies the user; we delete ALL auth_sid sessions
   * for that user (multi-device logout from auth-mock's perspective).
   *
   * @param userId - The user ID extracted from the `id_token_hint` JWT `sub` claim.
   * @returns Number of sessions deleted.
   */
  async deleteByUserId(userId: string): Promise<number> {
    let deleted = 0;
    for (const [sid, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(sid);
        deleted++;
      }
    }
    return deleted;
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: SESSION_TTL_MS,
      secure: process.env.AUTH_MOCK_TLS === 'on',
    };
  }

  onModuleDestroy(): void {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    this.sessions.clear();
  }
}
