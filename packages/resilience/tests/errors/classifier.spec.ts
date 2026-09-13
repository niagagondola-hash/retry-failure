import { describe, it, expect } from '@jest/globals';
import { classifyError } from '../../src/errors/classifier';

describe('classifyError — HTTP classification', () => {
  describe('5xx → retryable server_error', () => {
    for (const status of [500, 502, 503, 504]) {
      it(`status ${status} → retryable=true, reason=server_error`, () => {
        const r = classifyError({ kind: 'http', status });
        expect(r.retryable).toBe(true);
        expect(r.reason).toBe('server_error');
        expect(r.httpStatus).toBe(status);
      });
    }

    it('5xx with body containing error_code → errorCode extracted', () => {
      const r = classifyError({
        kind: 'http',
        status: 500,
        body: { error_code: 'internal_error', message: 'db down' },
      });
      expect(r.retryable).toBe(true);
      expect(r.errorCode).toBe('internal_error');
      expect(r.errorMessage).toBe('db down');
    });
  });

  describe('429 → retryable rate_limited', () => {
    it('429 without Retry-After header', () => {
      const r = classifyError({ kind: 'http', status: 429 });
      expect(r.retryable).toBe(true);
      expect(r.reason).toBe('rate_limited');
      expect(r.httpStatus).toBe(429);
      expect(r.retryAfterMs).toBeUndefined();
    });

    it('429 with Retry-After: 10 → retryAfterMs=10000', () => {
      const r = classifyError({
        kind: 'http',
        status: 429,
        headers: { 'retry-after': '10' },
      });
      expect(r.retryable).toBe(true);
      expect(r.reason).toBe('rate_limited');
      expect(r.retryAfterMs).toBe(10000);
    });

    it('429 with case-insensitive Retry-After header', () => {
      const r = classifyError({
        kind: 'http',
        status: 429,
        headers: { 'Retry-After': '5' },
      });
      expect(r.retryAfterMs).toBe(5000);
    });

    it('429 with HTTP-date Retry-After', () => {
      const future = new Date(Date.now() + 10_000);
      const r = classifyError({
        kind: 'http',
        status: 429,
        headers: { 'retry-after': future.toUTCString() },
      });
      expect(r.retryable).toBe(true);
      expect(r.retryAfterMs).not.toBeNull();
      expect(r.retryAfterMs ?? 0).toBeGreaterThanOrEqual(9000);
    });

    it('429 with array Retry-After header → takes first value', () => {
      const r = classifyError({
        kind: 'http',
        status: 429,
        headers: { 'retry-after': ['10', '20'] },
      });
      expect(r.retryAfterMs).toBe(10000);
    });

    it('429 with invalid Retry-After → retryAfterMs undefined (no throw)', () => {
      const r = classifyError({
        kind: 'http',
        status: 429,
        headers: { 'retry-after': 'garbage' },
      });
      expect(r.retryable).toBe(true);
      expect(r.reason).toBe('rate_limited');
      expect(r.retryAfterMs).toBeUndefined();
    });
  });

  describe('4xx selain 429 → permanent client_error', () => {
    for (const status of [400, 401, 403, 404, 422]) {
      it(`status ${status} → retryable=false, reason=client_error`, () => {
        const r = classifyError({ kind: 'http', status });
        expect(r.retryable).toBe(false);
        expect(r.reason).toBe('client_error');
        expect(r.httpStatus).toBe(status);
      });
    }

    it('400 with body error_code=invalid_card → errorCode extracted', () => {
      const r = classifyError({
        kind: 'http',
        status: 400,
        body: { error_code: 'invalid_card', message: 'Card number invalid' },
      });
      expect(r.retryable).toBe(false);
      expect(r.errorCode).toBe('invalid_card');
      expect(r.errorMessage).toBe('Card number invalid');
    });

    it('400 with body errorCode (camelCase) → errorCode extracted', () => {
      const r = classifyError({
        kind: 'http',
        status: 400,
        body: { errorCode: 'invalid_card', error: 'Card number invalid' },
      });
      expect(r.errorCode).toBe('invalid_card');
      expect(r.errorMessage).toBe('Card number invalid');
    });

    it('400 with empty body → no errorCode', () => {
      const r = classifyError({ kind: 'http', status: 400 });
      expect(r.retryable).toBe(false);
      expect(r.errorCode).toBeUndefined();
      expect(r.errorMessage).toBeUndefined();
    });
  });

  describe('2xx/3xx → success (caller ignore)', () => {
    for (const status of [200, 201, 204, 301, 302]) {
      it(`status ${status} → retryable=false, reason=success`, () => {
        const r = classifyError({ kind: 'http', status });
        expect(r.retryable).toBe(false);
        expect(r.reason).toBe('success');
      });
    }
  });

  it('unknown HTTP status (e.g. 700) → reason=unknown, retryable=false', () => {
    const r = classifyError({ kind: 'http', status: 700 });
    expect(r.retryable).toBe(false);
    expect(r.reason).toBe('unknown');
  });
});

describe('classifyError — network classification', () => {
  const retryableCases: Array<[string, string]> = [
    ['ECONNREFUSED', 'connection_refused'],
    ['ECONNRESET', 'connection_reset'],
    ['ETIMEDOUT', 'timeout'],
    ['ENOTFOUND', 'dns_failure'],
    ['EAI_AGAIN', 'dns_failure'],
  ];

  for (const [code, reason] of retryableCases) {
    it(`code ${code} → retryable=true, reason=${reason}`, () => {
      const r = classifyError({ kind: 'network', code, message: `failed: ${code}` });
      expect(r.retryable).toBe(true);
      expect(r.reason).toBe(reason);
      expect(r.errorCode).toBe(code);
      expect(r.errorMessage).toBe(`failed: ${code}`);
    });
  }

  it('unknown network code → retryable=false (safe default)', () => {
    const r = classifyError({ kind: 'network', code: 'EUNKNOWN', message: 'weird error' });
    expect(r.retryable).toBe(false);
    expect(r.reason).toBe('unknown');
    expect(r.errorCode).toBe('EUNKNOWN');
  });
});

describe('classifyError — timeout classification', () => {
  it('kind=timeout → retryable=true, reason=timeout', () => {
    const r = classifyError({ kind: 'timeout', message: 'request timeout after 2000ms' });
    expect(r.retryable).toBe(true);
    expect(r.reason).toBe('timeout');
    expect(r.errorMessage).toBe('request timeout after 2000ms');
  });
});
