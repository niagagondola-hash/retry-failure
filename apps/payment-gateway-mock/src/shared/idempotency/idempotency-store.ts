/**
 * In-memory idempotency store (plan section 9).
 *
 * Stores the result of successful charges keyed by `Idempotency-Key`.
 * Replays (same key) return the stored result with `replayed: true`.
 *
 * Failures are NOT stored — only successful captures.
 */

export interface ChargeResult {
  /** Gateway reference (UUID generated at capture time). */
  gatewayReference: string;
  /** ISO timestamp when the charge was actually captured. */
  capturedAt: string;
  /** Echo of original request body for traceability. */
  amount: number;
  currency: string;
  orderId?: string;
}

export interface IdempotencyStats {
  size: number;
  actualChargesCount: number;
}

export class IdempotencyStore {
  private readonly store = new Map<string, ChargeResult>();

  has(key: string): boolean {
    return this.store.has(key);
  }

  get(key: string): ChargeResult | undefined {
    return this.store.get(key);
  }

  set(key: string, result: ChargeResult): void {
    this.store.set(key, result);
  }

  delete(key: string): boolean {
    return this.store.delete(key);
  }

  get size(): number {
    return this.store.size;
  }

  stats(): IdempotencyStats {
    return {
      size: this.store.size,
      actualChargesCount: this.store.size,
    };
  }

  clear(): void {
    this.store.clear();
  }
}
