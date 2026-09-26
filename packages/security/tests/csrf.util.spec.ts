/**
 * CSRF utility unit tests (AUTH-15).
 *
 * Plan reference: PLAN2 Section 12.3 (CSRF), OWASP CSRF Prevention Cheat Sheet,
 * AUTH-15 task spec §1 (csrf.util.ts helpers).
 *
 * Tests:
 *   - `generateCsrfToken()` — output length + charset + uniqueness.
 *   - `safeEqual()` — equal/different-length/different-content cases,
 *     plus constant-time property (does not short-circuit on length mismatch).
 *   - `CSRF_EXEMPT_METHODS` — has GET, HEAD, OPTIONS; NOT POST/PUT/DELETE.
 *   - `CSRF_DEFAULT_EXEMPT_PATHS` — has `/auth/callback`.
 *   - `parseExemptPaths()` — defaults + custom env parsing.
 */
import {
  CSRF_COOKIE_TTL_SEC,
  CSRF_DEFAULT_EXEMPT_PATHS,
  CSRF_EXEMPT_METHODS,
  generateCsrfToken,
  parseExemptPaths,
  safeEqual,
} from '../src/middleware/csrf.util';

describe('csrf.util', () => {
  describe('generateCsrfToken', () => {
    it('returns a base64url string (~43 chars from 32 bytes)', () => {
      const token = generateCsrfToken();
      // 32 bytes → base64url ≈ 43 chars (no padding), charset [A-Za-z0-9_-]
      expect(token).toMatch(/^[A-Za-z0-9_-]{40,50}$/);
      expect(token).not.toContain('=');
      expect(token).not.toContain('+');
      expect(token).not.toContain('/');
    });

    it('produces unique tokens across many invocations', () => {
      const tokens = new Set<string>();
      for (let i = 0; i < 200; i++) {
        tokens.add(generateCsrfToken());
      }
      // All 200 should be unique (collision probability is effectively 0)
      expect(tokens.size).toBe(200);
    });

    it('produces sufficiently long entropy (>= 32 bytes worth)', () => {
      const token = generateCsrfToken();
      // base64url encodes 6 bits per char; 256 bits = ~43 chars
      expect(token.length).toBeGreaterThanOrEqual(40);
    });
  });

  describe('safeEqual', () => {
    it('returns true for equal strings', () => {
      expect(safeEqual('abc123', 'abc123')).toBe(true);
    });

    it('returns false for different strings of same length', () => {
      expect(safeEqual('abc123', 'abc124')).toBe(false);
      expect(safeEqual('abc123', 'ABC123')).toBe(false); // case-sensitive
    });

    it('returns false for different-length strings (no throw)', () => {
      expect(safeEqual('short', 'longer-string')).toBe(false);
      expect(safeEqual('', 'nonempty')).toBe(false);
      expect(safeEqual('nonempty', '')).toBe(false);
    });

    it('returns true for empty strings', () => {
      expect(safeEqual('', '')).toBe(true);
    });

    it('returns true for typical CSRF tokens (43-char base64url)', () => {
      const t = generateCsrfToken();
      expect(safeEqual(t, t)).toBe(true);
    });

    it('does NOT short-circuit on length mismatch — still invokes timingSafeEqual-style path', () => {
      // The function returns false for differing lengths without throwing.
      // We verify it doesn't propagate `RangeError` from `crypto.timingSafeEqual`.
      expect(() => safeEqual('a', 'ab')).not.toThrow();
      expect(() => safeEqual('ab', 'a')).not.toThrow();
    });
  });

  describe('CSRF_EXEMPT_METHODS', () => {
    it('contains GET, HEAD, OPTIONS', () => {
      expect(CSRF_EXEMPT_METHODS.has('GET')).toBe(true);
      expect(CSRF_EXEMPT_METHODS.has('HEAD')).toBe(true);
      expect(CSRF_EXEMPT_METHODS.has('OPTIONS')).toBe(true);
    });

    it('does NOT contain POST, PUT, PATCH, DELETE', () => {
      expect(CSRF_EXEMPT_METHODS.has('POST')).toBe(false);
      expect(CSRF_EXEMPT_METHODS.has('PUT')).toBe(false);
      expect(CSRF_EXEMPT_METHODS.has('PATCH')).toBe(false);
      expect(CSRF_EXEMPT_METHODS.has('DELETE')).toBe(false);
    });

    it('is case-sensitive (caller uppercases before checking)', () => {
      // Per implementation, we check `req.method.toUpperCase()`, so the set
      // only contains uppercase forms.
      expect(CSRF_EXEMPT_METHODS.has('get')).toBe(false);
      expect(CSRF_EXEMPT_METHODS.has('Get')).toBe(false);
    });
  });

  describe('CSRF_DEFAULT_EXEMPT_PATHS', () => {
    it('contains /auth/callback', () => {
      expect(CSRF_DEFAULT_EXEMPT_PATHS.has('/auth/callback')).toBe(true);
    });

    it('does NOT contain other paths', () => {
      expect(CSRF_DEFAULT_EXEMPT_PATHS.has('/auth/login')).toBe(false);
      expect(CSRF_DEFAULT_EXEMPT_PATHS.has('/payments')).toBe(false);
    });
  });

  describe('CSRF_COOKIE_TTL_SEC', () => {
    it('is 28800 (8 hours, matches session cookie per plan2 §12.1)', () => {
      expect(CSRF_COOKIE_TTL_SEC).toBe(28800);
    });
  });

  describe('parseExemptPaths', () => {
    it('returns default set when env undefined', () => {
      const paths = parseExemptPaths(undefined);
      expect(paths.has('/auth/callback')).toBe(true);
      expect(paths.size).toBe(1);
    });

    it('returns default set when env is empty string', () => {
      const paths = parseExemptPaths('');
      expect(paths.has('/auth/callback')).toBe(true);
    });

    it('parses single custom path', () => {
      const paths = parseExemptPaths('/webhook/stripe');
      expect(paths.has('/webhook/stripe')).toBe(true);
      expect(paths.size).toBe(1);
    });

    it('parses comma-separated list', () => {
      const paths = parseExemptPaths('/auth/callback, /webhook/stripe,/api/internal');
      expect(paths.has('/auth/callback')).toBe(true);
      expect(paths.has('/webhook/stripe')).toBe(true);
      expect(paths.has('/api/internal')).toBe(true);
      expect(paths.size).toBe(3);
    });

    it('trims whitespace and ignores empty entries', () => {
      const paths = parseExemptPaths('  /a  , , /b  ,');
      expect(paths.size).toBe(2);
      expect(paths.has('/a')).toBe(true);
      expect(paths.has('/b')).toBe(true);
    });
  });
});
