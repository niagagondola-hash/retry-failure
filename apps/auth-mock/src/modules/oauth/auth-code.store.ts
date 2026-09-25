/**
 * AuthCodeStore — in-memory authorization code store with TTL 60s.
 *
 * Plan reference: PLAN2 Section 5.3 (expiry), AUTH-03 task spec §3.
 * RFC 6749 §4.1.2 recommends max 10 minutes; we use 60s for safety.
 *
 * Codes are one-time use: once consumed, subsequent lookups return null.
 * Expired codes are lazily purged on read + a setTimeout fallback.
 */
import { Injectable, OnModuleDestroy } from '@nestjs/common';

export interface StoredAuthCode {
  code: string;
  clientId: string;
  userId: string;
  roleId: string;
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
  scope: string;
  /** Unix epoch ms when code expires. */
  expiresAt: number;
  /** Set true on first consume — one-time use enforcement. */
  consumed: boolean;
}

@Injectable()
export class AuthCodeStore implements OnModuleDestroy {
  private readonly codes = new Map<string, StoredAuthCode>();
  private readonly ttlMs = 60_000; // 60s per RFC 6749 §4.1.2
  private readonly timers = new Set<NodeJS.Timeout>();

  /** Store a freshly-issued authorization code. */
  async store(entry: StoredAuthCode): Promise<void> {
    this.codes.set(entry.code, entry);
    const t = setTimeout(() => {
      this.codes.delete(entry.code);
      this.timers.delete(t);
    }, this.ttlMs);
    t.unref?.();
    this.timers.add(t);
  }

  /**
   * Consume a code: returns the stored entry if valid + not consumed + not
   * expired, and marks it consumed (so a second call returns null).
   * The caller is responsible for deleting after successful exchange (we keep
   * it around briefly so a duplicate exchange attempt returns `invalid_grant`
   * rather than `invalid_code` — clearer error semantics).
   */
  async consume(code: string): Promise<StoredAuthCode | null> {
    const entry = this.codes.get(code);
    if (!entry) return null;
    if (entry.consumed) return null;
    if (Date.now() > entry.expiresAt) {
      this.codes.delete(code);
      return null;
    }
    entry.consumed = true;
    return entry;
  }

  /** Delete a code immediately (called after successful token exchange). */
  async delete(code: string): Promise<void> {
    this.codes.delete(code);
  }

  /** Test helper: peek without consuming. */
  async peek(code: string): Promise<StoredAuthCode | null> {
    return this.codes.get(code) ?? null;
  }

  onModuleDestroy(): void {
    for (const t of this.timers) {
      clearTimeout(t);
    }
    this.timers.clear();
    this.codes.clear();
  }
}
