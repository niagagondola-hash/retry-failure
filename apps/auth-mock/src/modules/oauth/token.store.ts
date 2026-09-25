/**
 * TokenStore — refresh token rotation + reuse detection (AUTH-03).
 *
 * Plan reference: PLAN2 Section 5.4 (Refresh rotation), Section 5.5 (Revoke).
 *
 * Tracks every refresh token issued, keyed by `jti` (the JWT ID claim).
 * On rotation:
 *   1. The old refresh token is marked `revoked: true`.
 *   2. A new refresh token is issued + stored.
 * On reuse detection:
 *   - If a `revoked: true` refresh token is presented again (reuse),
 *     panic-revoke ALL tokens (access + refresh) belonging to that user.
 *
 * Access tokens are also tracked so `/oauth/revoke` can mark them revoked
 * (RFC 7009). We don't reject *access* tokens here at verify time — the
 * verifier checks signature + expiry. Revocation is enforced by SessionGuard
 * consulting SessionStore in payment-api (AUTH-13). For auth-mock, this
 * store simply records the revocation so introspection (if added later)
 * reports correctly.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';

export interface StoredToken {
  jti: string;
  userId: string;
  clientId: string;
  roleId: string;
  type: 'access' | 'refresh';
  /** Unix epoch ms when token expires. */
  expiresAt: number;
  revoked: boolean;
}

@Injectable()
export class TokenStore implements OnModuleDestroy {
  private readonly tokens = new Map<string, StoredToken>();
  /** userId -> set of jtis (for panic-revoke on reuse). */
  private readonly userSessions = new Map<string, Set<string>>();

  /** Insert a new token (access or refresh). */
  async store(token: StoredToken): Promise<void> {
    this.tokens.set(token.jti, token);
    if (!this.userSessions.has(token.userId)) {
      this.userSessions.set(token.userId, new Set());
    }
    this.userSessions.get(token.userId)!.add(token.jti);
  }

  /** Lookup by jti. */
  async get(jti: string): Promise<StoredToken | null> {
    return this.tokens.get(jti) ?? null;
  }

  /** Mark a single token revoked. Idempotent. */
  async revoke(jti: string): Promise<void> {
    const t = this.tokens.get(jti);
    if (t) t.revoked = true;
  }

  /** Check if a token has been revoked. */
  async isRevoked(jti: string): Promise<boolean> {
    const t = this.tokens.get(jti);
    if (!t) return false; // unknown token — not "revoked" (per RFC 7009 /oauth/revoke returns 200)
    return t.revoked;
  }

  /** Panic-revoke: every token (access + refresh) belonging to user. */
  async revokeAllForUser(userId: string): Promise<void> {
    const session = this.userSessions.get(userId);
    if (!session) return;
    for (const jti of session) {
      const t = this.tokens.get(jti);
      if (t) t.revoked = true;
    }
  }

  /**
   * Reuse detection — invoked before issuing a refresh.
   * If the refresh token is already `revoked`, the caller MUST treat this as
   * theft: revoke all sessions for this user, then reject the request.
   * Returns true if reuse was detected.
   */
  async detectReuseAndPanic(jti: string): Promise<boolean> {
    const t = this.tokens.get(jti);
    if (!t) return false;
    if (t.type === 'refresh' && t.revoked) {
      await this.revokeAllForUser(t.userId);
      return true;
    }
    return false;
  }

  onModuleDestroy(): void {
    this.tokens.clear();
    this.userSessions.clear();
  }
}
