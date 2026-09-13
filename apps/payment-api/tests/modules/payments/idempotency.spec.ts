import { describe, it, expect } from '@jest/globals';
import { deriveIdempotencyKey, assertInvariant } from '../../../src/modules/payments/idempotency';

describe('deriveIdempotencyKey (re-export dari TASK-06)', () => {
  it('returns paymentId as-is', () => {
    expect(deriveIdempotencyKey('pay-123')).toBe('pay-123');
  });
  it('throws on empty string', () => {
    expect(() => deriveIdempotencyKey('')).toThrow();
  });
  it('throws on whitespace', () => {
    expect(() => deriveIdempotencyKey('   ')).toThrow();
  });
});

describe('assertInvariant (plan section 9.1)', () => {
  it('actualCharges=1, httpCalls=5 → true (invariant hold)', () => {
    expect(assertInvariant(1, 5)).toBe(true);
  });
  it('actualCharges=2, httpCalls=5 → false (invariant violated)', () => {
    expect(assertInvariant(2, 5)).toBe(false);
  });
  it('actualCharges=0, httpCalls=0 → true', () => {
    expect(assertInvariant(0, 0)).toBe(true);
  });
  it('actualCharges=1, httpCalls=1 → true', () => {
    expect(assertInvariant(1, 1)).toBe(true);
  });
});
