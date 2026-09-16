import { describe, it, expect } from '@jest/globals';
import { parseRetryAfter } from '../../src/errors/retry-after';

describe('parseRetryAfter — delta-seconds', () => {
  it('"10" -> 10000 ms', () => {
    expect(parseRetryAfter('10')).toBe(10000);
  });

  it('"0" -> 0 ms', () => {
    expect(parseRetryAfter('0')).toBe(0);
  });

  it('"120" -> 120000 ms', () => {
    expect(parseRetryAfter('120')).toBe(120000);
  });

  it('"  5  " (with whitespace) -> 5000 ms', () => {
    expect(parseRetryAfter('  5  ')).toBe(5000);
  });
});

describe('parseRetryAfter — HTTP-date', () => {
  it('RFC 7231 date 10s in future -> 10000 ms', () => {
    const now = new Date('2025-10-21T07:27:50Z');
    const header = 'Wed, 21 Oct 2025 07:28:00 GMT';
    expect(parseRetryAfter(header, now)).toBe(10000);
  });

  it('date in past -> 0 ms (clamped)', () => {
    const now = new Date('2025-10-21T07:28:30Z');
    const header = 'Wed, 21 Oct 2025 07:28:00 GMT';
    expect(parseRetryAfter(header, now)).toBe(0);
  });

  it('ISO date string 5s in future -> 5000 ms', () => {
    const now = new Date('2025-10-21T00:00:00Z');
    const header = new Date('2025-10-21T00:00:05Z').toISOString();
    expect(parseRetryAfter(header, now)).toBe(5000);
  });
});

describe('parseRetryAfter — null / empty / invalid', () => {
  it('null -> null', () => {
    expect(parseRetryAfter(null)).toBeNull();
  });

  it('undefined -> null', () => {
    expect(parseRetryAfter(undefined)).toBeNull();
  });

  it('"" (empty string) -> null', () => {
    expect(parseRetryAfter('')).toBeNull();
  });

  it('"   " (whitespace only) -> null', () => {
    expect(parseRetryAfter('   ')).toBeNull();
  });

  it('"garbage" -> null (no throw)', () => {
    expect(parseRetryAfter('garbage')).toBeNull();
  });

  it('"-5" (negative) -> null', () => {
    expect(parseRetryAfter('-5')).toBeNull();
  });

  it('"5.5" (float) -> null', () => {
    expect(parseRetryAfter('5.5')).toBeNull();
  });

  it('"123abc" (mixed) -> null', () => {
    expect(parseRetryAfter('123abc')).toBeNull();
  });

  it('"Wed, 99 Oct 2025 07:28:00 GMT" (invalid date) -> null', () => {
    expect(parseRetryAfter('Wed, 99 Oct 2025 07:28:00 GMT')).toBeNull();
  });
});

describe('parseRetryAfter — custom now parameter', () => {
  it('uses injected now for HTTP-date calculation', () => {
    const now = new Date('2025-01-01T00:00:00Z');
    const future = new Date('2025-01-01T00:00:30Z').toUTCString();
    expect(parseRetryAfter(future, now)).toBe(30000);
  });
});
