import { describe, it, expect } from '@jest/globals';
import { deriveIdempotencyKey } from '../../../src/modules/gateway/idempotency-key';

describe('deriveIdempotencyKey', () => {
  it('returns paymentId as-is (plan section 9: no hash)', () => {
    expect(deriveIdempotencyKey('pay-123')).toBe('pay-123');
  });

  it('returns UUID as-is', () => {
    const uuid = '550e8400-e29b-41d4-a716-446655440000';
    expect(deriveIdempotencyKey(uuid)).toBe(uuid);
  });

  it('throws on empty string', () => {
    expect(() => deriveIdempotencyKey('')).toThrow('paymentId is required');
  });

  it('throws on whitespace-only string', () => {
    expect(() => deriveIdempotencyKey('   ')).toThrow('paymentId is required');
  });

  it('throws on null/undefined', () => {
    expect(() => deriveIdempotencyKey(null as unknown as string)).toThrow();
    expect(() => deriveIdempotencyKey(undefined as unknown as string)).toThrow();
  });
});
