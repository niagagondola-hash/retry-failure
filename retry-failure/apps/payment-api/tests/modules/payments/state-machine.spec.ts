import { describe, it, expect } from '@jest/globals';
import {
  VALID_TRANSITIONS,
  canTransition,
  assertCanTransition,
  isTerminal,
  InvalidTransitionError,
} from '../../../src/modules/payments/state-machine';
import { PaymentStatus } from '../../../src/database/entities/enums';

describe('state-machine - VALID_TRANSITIONS', () => {
  it('processing -> succeeded|failed|scheduled_for_retry', () => {
    expect(VALID_TRANSITIONS[PaymentStatus.PROCESSING]).toContain(PaymentStatus.SUCCEEDED);
    expect(VALID_TRANSITIONS[PaymentStatus.PROCESSING]).toContain(PaymentStatus.FAILED);
    expect(VALID_TRANSITIONS[PaymentStatus.PROCESSING]).toContain(PaymentStatus.SCHEDULED_FOR_RETRY);
  });

  it('scheduled_for_retry -> processing|failed', () => {
    expect(VALID_TRANSITIONS[PaymentStatus.SCHEDULED_FOR_RETRY]).toContain(PaymentStatus.PROCESSING);
    expect(VALID_TRANSITIONS[PaymentStatus.SCHEDULED_FOR_RETRY]).toContain(PaymentStatus.FAILED);
  });

  it('failed -> processing (manualRetry only)', () => {
    expect(VALID_TRANSITIONS[PaymentStatus.FAILED]).toContain(PaymentStatus.PROCESSING);
  });

  it('succeeded -> [] (terminal, no transitions)', () => {
    expect(VALID_TRANSITIONS[PaymentStatus.SUCCEEDED]).toEqual([]);
  });
});

describe('canTransition', () => {
  it('processing -> succeeded = true', () => {
    expect(canTransition(PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED)).toBe(true);
  });
  it('processing -> failed = true', () => {
    expect(canTransition(PaymentStatus.PROCESSING, PaymentStatus.FAILED)).toBe(true);
  });
  it('processing -> scheduled_for_retry = true', () => {
    expect(canTransition(PaymentStatus.PROCESSING, PaymentStatus.SCHEDULED_FOR_RETRY)).toBe(true);
  });
  it('scheduled_for_retry -> processing = true', () => {
    expect(canTransition(PaymentStatus.SCHEDULED_FOR_RETRY, PaymentStatus.PROCESSING)).toBe(true);
  });
  it('succeeded -> processing = false (terminal)', () => {
    expect(canTransition(PaymentStatus.SUCCEEDED, PaymentStatus.PROCESSING)).toBe(false);
  });
  it('failed -> processing = true (manualRetry)', () => {
    expect(canTransition(PaymentStatus.FAILED, PaymentStatus.PROCESSING)).toBe(true);
  });
  it('failed -> succeeded = false (must go through processing)', () => {
    expect(canTransition(PaymentStatus.FAILED, PaymentStatus.SUCCEEDED)).toBe(false);
  });
  it('succeeded -> failed = false', () => {
    expect(canTransition(PaymentStatus.SUCCEEDED, PaymentStatus.FAILED)).toBe(false);
  });
});

describe('assertCanTransition', () => {
  it('does not throw for valid transition', () => {
    expect(() => assertCanTransition(PaymentStatus.PROCESSING, PaymentStatus.SUCCEEDED)).not.toThrow();
  });
  it('throws InvalidTransitionError for invalid transition', () => {
    expect(() => assertCanTransition(PaymentStatus.SUCCEEDED, PaymentStatus.FAILED)).toThrow(InvalidTransitionError);
  });
  it('error message includes from -> to', () => {
    try {
      assertCanTransition(PaymentStatus.SUCCEEDED, PaymentStatus.PROCESSING);
      fail('should have thrown');
    } catch (e) {
      expect(e instanceof InvalidTransitionError).toBe(true);
      expect((e as InvalidTransitionError).from).toBe(PaymentStatus.SUCCEEDED);
      expect((e as InvalidTransitionError).to).toBe(PaymentStatus.PROCESSING);
    }
  });
});

describe('isTerminal', () => {
  it('succeeded = true', () => {
    expect(isTerminal(PaymentStatus.SUCCEEDED)).toBe(true);
  });
  it('failed = true', () => {
    expect(isTerminal(PaymentStatus.FAILED)).toBe(true);
  });
  it('processing = false', () => {
    expect(isTerminal(PaymentStatus.PROCESSING)).toBe(false);
  });
  it('scheduled_for_retry = false', () => {
    expect(isTerminal(PaymentStatus.SCHEDULED_FOR_RETRY)).toBe(false);
  });
});

// Helper used by .toThrow() matcher
function fail(msg: string): never {
  throw new Error(msg);
}
