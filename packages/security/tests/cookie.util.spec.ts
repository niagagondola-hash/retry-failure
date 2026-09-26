/**
 * Cookie utilities unit tests (AUTH-12).
 *
 * Plan reference: AUTH-12 task spec §1, PLAN2 §12.1 (cookie attributes).
 */
import type { Request, Response } from 'express';

import {
  buildSessionCookie,
  setSessionCookie,
  clearSessionCookie,
  setClearSessionCookie,
  parseSessionCookie,
  DEFAULT_SESSION_COOKIE_NAME,
  CookieOptions,
} from '../src/oauth/cookie.util';

describe('cookie.util', () => {
  describe('buildSessionCookie', () => {
    const defaultOpts: CookieOptions = { maxAgeMs: 3600_000 }; // 1 hour

    it('builds cookie with all required attributes', () => {
      const cookie = buildSessionCookie('abc123', defaultOpts);
      expect(cookie).toMatch(/^sid=abc123/);
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('Max-Age=3600'); // 3600000ms / 1000 = 3600s
    });

    it('uses custom name when provided', () => {
      const cookie = buildSessionCookie('xyz', { ...defaultOpts, name: 'session_id' });
      expect(cookie).toMatch(/^session_id=xyz/);
    });

    it('uses default name "sid" when name not provided', () => {
      const cookie = buildSessionCookie('val', defaultOpts);
      expect(cookie).toMatch(/^sid=val/);
    });

    it('capitalizes SameSite correctly (lax → Lax, strict → Strict, none → None)', () => {
      expect(buildSessionCookie('x', { ...defaultOpts, sameSite: 'strict' })).toContain('SameSite=Strict');
      expect(buildSessionCookie('x', { ...defaultOpts, sameSite: 'none' })).toContain('SameSite=None');
      expect(buildSessionCookie('x', { ...defaultOpts, sameSite: 'lax' })).toContain('SameSite=Lax');
    });

    it('omits Secure when secure=false (dev mode)', () => {
      const cookie = buildSessionCookie('abc', { ...defaultOpts, secure: false });
      expect(cookie).not.toContain('Secure');
      expect(cookie).toContain('HttpOnly');
    });

    it('includes Domain when provided', () => {
      const cookie = buildSessionCookie('abc', { ...defaultOpts, domain: 'example.com' });
      expect(cookie).toContain('Domain=example.com');
    });

    it('uses custom Path when provided', () => {
      const cookie = buildSessionCookie('abc', { ...defaultOpts, path: '/api' });
      expect(cookie).toContain('Path=/api');
    });

    it('converts maxAgeMs to Max-Age seconds correctly', () => {
      // 8 hours in ms
      const cookie = buildSessionCookie('abc', { maxAgeMs: 8 * 60 * 60 * 1000 });
      expect(cookie).toContain('Max-Age=28800'); // 8 * 3600 = 28800
    });

    it('handles 0 maxAge', () => {
      const cookie = buildSessionCookie('abc', { maxAgeMs: 0 });
      expect(cookie).toContain('Max-Age=0');
    });
  });

  describe('setSessionCookie', () => {
    it('sets Set-Cookie header on response', () => {
      const headers: Record<string, string> = {};
      const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as unknown as Response;
      setSessionCookie(res, 'sid-value', { maxAgeMs: 3600_000 });
      expect(headers['Set-Cookie']).toContain('sid=sid-value');
      expect(headers['Set-Cookie']).toContain('HttpOnly');
    });
  });

  describe('clearSessionCookie', () => {
    it('returns cookie with Max-Age=0', () => {
      const cookie = clearSessionCookie();
      expect(cookie).toContain('sid=');
      expect(cookie).toContain('Max-Age=0');
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
    });

    it('uses custom name', () => {
      const cookie = clearSessionCookie('custom_sid');
      expect(cookie).toMatch(/^custom_sid=/);
    });

    it('uses custom path', () => {
      const cookie = clearSessionCookie('sid', '/api');
      expect(cookie).toContain('Path=/api');
    });
  });

  describe('setClearSessionCookie', () => {
    it('sets Set-Cookie header with cleared cookie', () => {
      const headers: Record<string, string> = {};
      const res = { setHeader: (k: string, v: string) => { headers[k] = v; } } as unknown as Response;
      setClearSessionCookie(res);
      expect(headers['Set-Cookie']).toContain('Max-Age=0');
    });
  });

  describe('parseSessionCookie', () => {
    it('returns sid from req.cookies (cookie-parser middleware output)', () => {
      const req = { cookies: { sid: 'cookie-parser-value' } } as unknown as Request;
      expect(parseSessionCookie(req)).toBe('cookie-parser-value');
    });

    it('returns null when req.cookies is empty object', () => {
      const req = { cookies: {} } as unknown as Request;
      expect(parseSessionCookie(req)).toBeNull();
    });

    it('falls back to manual parsing when cookies object not set', () => {
      const req = {
        headers: { cookie: 'sid=manual-value; other=val' },
      } as unknown as Request;
      expect(parseSessionCookie(req)).toBe('manual-value');
    });

    it('returns null when no Cookie header present', () => {
      const req = { headers: {} } as unknown as Request;
      expect(parseSessionCookie(req)).toBeNull();
    });

    it('handles multiple cookies in Cookie header', () => {
      const req = {
        headers: { cookie: 'theme=dark; sid=target-sid; lang=en' },
      } as unknown as Request;
      expect(parseSessionCookie(req)).toBe('target-sid');
    });

    it('uses custom name when provided', () => {
      const req = {
        cookies: { custom_session: 'custom-val' },
      } as unknown as Request;
      expect(parseSessionCookie(req, 'custom_session')).toBe('custom-val');
    });

    it('returns null for empty cookie value', () => {
      const req = {
        headers: { cookie: 'sid=' },
      } as unknown as Request;
      expect(parseSessionCookie(req)).toBeNull();
    });

    it('trims whitespace around cookie parts', () => {
      const req = {
        headers: { cookie: '  sid=trimmed-val  ;  other=val  ' },
      } as unknown as Request;
      expect(parseSessionCookie(req)).toBe('trimmed-val');
    });
  });

  describe('DEFAULT_SESSION_COOKIE_NAME', () => {
    it('is "sid"', () => {
      expect(DEFAULT_SESSION_COOKIE_NAME).toBe('sid');
    });
  });
});
