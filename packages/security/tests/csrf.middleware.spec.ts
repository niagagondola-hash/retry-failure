/**
 * CsrfMiddleware unit tests (AUTH-15).
 *
 * Plan reference: PLAN2 Section 12.3 (CSRF — double-submit cookie),
 * Section 14.6 (AUTH_MODE=disabled), Section 16 (CSRF_* env vars),
 * AUTH-15 task spec §7.
 *
 * Mocks: Express Request/Response objects (no real HTTP server needed).
 */
import type { NextFunction, Request, Response } from 'express';

import { CsrfMiddleware } from '../src/middleware/csrf.middleware';
import type { SecurityOptions } from '../src/security.module';

interface MockReqOpts {
  method?: string;
  path?: string;
  cookieHeader?: string;
  csrfHeader?: string;
  parsedCookies?: Record<string, string>;
}

interface MockRes {
  res: Response;
  setHeader: jest.Mock;
  status: jest.Mock;
  json: jest.Mock;
  locals: Record<string, unknown>;
}

function mockReq(opts: MockReqOpts): Request {
  const req = {
    method: opts.method ?? 'GET',
    path: opts.path ?? '/payments',
    headers: {} as Record<string, string | string[] | undefined>,
    cookies: opts.parsedCookies,
  } as unknown as Request;
  if (opts.cookieHeader !== undefined) req.headers.cookie = opts.cookieHeader;
  if (opts.csrfHeader !== undefined) req.headers['x-csrf-token'] = opts.csrfHeader;
  return req;
}

function mockRes(): MockRes {
  const setHeader = jest.fn();
  const status = jest.fn().mockReturnThis();
  const json = jest.fn().mockReturnThis();
  const res = {
    setHeader,
    status,
    json,
    locals: {} as Record<string, unknown>,
  } as unknown as Response;
  return { res, setHeader, status, json, locals: res.locals as Record<string, unknown> };
}

const defaultOptions: SecurityOptions = {
  authMode: 'oauth',
  sessionStore: 'memory',
};

function buildMiddleware(opts: SecurityOptions = defaultOptions): CsrfMiddleware {
  return new CsrfMiddleware(opts);
}

/** Helper: get the Set-Cookie header value from the mock res, or empty string. */
function getSetCookie(mock: MockRes): string {
  const calls = mock.setHeader.mock.calls as [string, string][];
  const call = calls.find(([name]) => name === 'Set-Cookie');
  return call ? call[1] : '';
}

describe('CsrfMiddleware', () => {
  const next: NextFunction = jest.fn();

  beforeEach(() => {
    (next as jest.Mock).mockClear();
    delete process.env.NODE_ENV;
    delete process.env.CSRF_EXEMPT_PATHS;
  });

  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.CSRF_EXEMPT_PATHS;
  });

  describe('AUTH_MODE=disabled', () => {
    it('skips entirely — no cookie issued, no validation, next() called', async () => {
      const mw = buildMiddleware({ ...defaultOptions, authMode: 'disabled' });
      const m = mockRes();
      await mw.use(mockReq({ method: 'POST', path: '/payments' }), m.res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(m.setHeader).not.toHaveBeenCalled();
      expect(m.status).not.toHaveBeenCalled();
    });
  });

  describe('cookie issuance (no XSRF-TOKEN cookie)', () => {
    it('GET /auth/csrf → sets XSRF-TOKEN cookie + exposes res.locals.csrfToken + next()', async () => {
      const m = mockRes();
      await buildMiddleware().use(mockReq({ method: 'GET', path: '/auth/csrf' }), m.res, next);
      expect(next).toHaveBeenCalledTimes(1);
      const cookie = getSetCookie(m);
      expect(cookie).toMatch(/^XSRF-TOKEN=[A-Za-z0-9_-]{40,50}/);
      expect(cookie).toContain('HttpOnly=false');
      expect(cookie).toContain('SameSite=Lax');
      expect(cookie).toContain('Path=/');
      expect(cookie).toContain('Max-Age=28800');
      expect(cookie).not.toContain('Secure');
      expect(m.locals.csrfToken).toEqual(expect.stringMatching(/^[A-Za-z0-9_-]{40,50}$/));
    });

    it('POST /payments with no cookie → issues fresh cookie AND returns 403', async () => {
      const m = mockRes();
      await buildMiddleware().use(mockReq({ method: 'POST', path: '/payments' }), m.res, next);
      expect(m.setHeader).toHaveBeenCalledTimes(1); // Cookie still gets issued
      expect(next).not.toHaveBeenCalled();
      expect(m.status).toHaveBeenCalledWith(403);
      expect(m.json).toHaveBeenCalledWith({
        statusCode: 403,
        message: 'Invalid CSRF token',
      });
    });

    it('adds Secure attribute when NODE_ENV=production', async () => {
      process.env.NODE_ENV = 'production';
      const m = mockRes();
      await buildMiddleware().use(mockReq({ method: 'GET', path: '/auth/csrf' }), m.res, next);
      expect(getSetCookie(m)).toContain('Secure');
    });

    it('does NOT re-issue cookie when already present (safe request)', async () => {
      const m = mockRes();
      await buildMiddleware().use(
        mockReq({ method: 'GET', path: '/payments', cookieHeader: 'XSRF-TOKEN=existing-token' }),
        m.res,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
      expect(m.setHeader).not.toHaveBeenCalled();
      expect(m.locals.csrfToken).toBeUndefined();
    });
  });

  describe('safe methods (GET, HEAD, OPTIONS) — exempt from validation', () => {
    it.each([
      ['GET', '/payments'],
      ['HEAD', '/payments'],
      ['OPTIONS', '/payments'],
    ])('%s %s with cookie present + no header → next() (no validation)', async (method, path) => {
      const m = mockRes();
      await buildMiddleware().use(
        mockReq({ method, path, cookieHeader: 'XSRF-TOKEN=abc123' }),
        m.res,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
      expect(m.setHeader).not.toHaveBeenCalled();
      expect(m.status).not.toHaveBeenCalled();
    });

    it('safe method is case-insensitive (lowercase "get" also exempt)', async () => {
      const m = mockRes();
      await buildMiddleware().use(
        mockReq({ method: 'get', path: '/payments', cookieHeader: 'XSRF-TOKEN=abc123' }),
        m.res,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
      expect(m.status).not.toHaveBeenCalled();
    });
  });

  describe('exempt paths', () => {
    it('POST /auth/callback → exempt, next() called (no header required)', async () => {
      const m = mockRes();
      await buildMiddleware().use(mockReq({ method: 'POST', path: '/auth/callback' }), m.res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(m.status).not.toHaveBeenCalled();
    });

    it('custom exempt path via CSRF_EXEMPT_PATHS env', async () => {
      process.env.CSRF_EXEMPT_PATHS = '/webhook/stripe,/auth/callback';
      const m = mockRes();
      await buildMiddleware().use(
        mockReq({ method: 'POST', path: '/webhook/stripe' }),
        m.res,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
      expect(m.status).not.toHaveBeenCalled();
    });

    it('non-exempt unsafe path with no header → 403', async () => {
      const m = mockRes();
      await buildMiddleware().use(
        mockReq({ method: 'POST', path: '/payments', cookieHeader: 'XSRF-TOKEN=abc123' }),
        m.res,
        next,
      );
      expect(next).not.toHaveBeenCalled();
      expect(m.status).toHaveBeenCalledWith(403);
    });
  });

  describe('double-submit validation', () => {
    it('cookie + header match → next() called', async () => {
      const m = mockRes();
      await buildMiddleware().use(
        mockReq({
          method: 'POST', path: '/payments',
          cookieHeader: 'XSRF-TOKEN=abc123', csrfHeader: 'abc123',
        }),
        m.res,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
      expect(m.status).not.toHaveBeenCalled();
    });

    it('cookie + header mismatch → 403 with { statusCode: 403, message: "Invalid CSRF token" }', async () => {
      const m = mockRes();
      await buildMiddleware().use(
        mockReq({
          method: 'POST', path: '/payments',
          cookieHeader: 'XSRF-TOKEN=abc123', csrfHeader: 'different-value',
        }),
        m.res,
        next,
      );
      expect(next).not.toHaveBeenCalled();
      expect(m.status).toHaveBeenCalledWith(403);
      expect(m.json).toHaveBeenCalledWith({
        statusCode: 403,
        message: 'Invalid CSRF token',
      });
    });

    it('cookie present + header missing → 403', async () => {
      const m = mockRes();
      await buildMiddleware().use(
        mockReq({ method: 'POST', path: '/payments', cookieHeader: 'XSRF-TOKEN=abc123' }),
        m.res,
        next,
      );
      expect(next).not.toHaveBeenCalled();
      expect(m.status).toHaveBeenCalledWith(403);
    });

    it('uses cookie-parser output if available (req.cookies.XSRF-TOKEN)', async () => {
      const m = mockRes();
      await buildMiddleware().use(
        mockReq({
          method: 'POST', path: '/payments',
          parsedCookies: { 'XSRF-TOKEN': 'from-parser' }, csrfHeader: 'from-parser',
        }),
        m.res,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
      expect(m.status).not.toHaveBeenCalled();
    });
  });

  describe('CSRF_ENABLED=false', () => {
    it('GET /auth/csrf → still issues cookie (FE needs it)', async () => {
      const mw = buildMiddleware({ ...defaultOptions, csrfEnabled: false });
      const m = mockRes();
      await mw.use(mockReq({ method: 'GET', path: '/auth/csrf' }), m.res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(m.setHeader).toHaveBeenCalledTimes(1);
    });

    it('POST /payments with NO header → next() called (validation skipped)', async () => {
      const mw = buildMiddleware({ ...defaultOptions, csrfEnabled: false });
      const m = mockRes();
      await mw.use(
        mockReq({ method: 'POST', path: '/payments', cookieHeader: 'XSRF-TOKEN=abc123' }),
        m.res,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
      expect(m.status).not.toHaveBeenCalled();
    });

    it('POST /payments with mismatched header → next() called (validation skipped)', async () => {
      const mw = buildMiddleware({ ...defaultOptions, csrfEnabled: false });
      const m = mockRes();
      await mw.use(
        mockReq({
          method: 'POST', path: '/payments',
          cookieHeader: 'XSRF-TOKEN=abc123', csrfHeader: 'mismatch',
        }),
        m.res,
        next,
      );
      expect(next).toHaveBeenCalledTimes(1);
      expect(m.status).not.toHaveBeenCalled();
    });

    it('AUTH_MODE=disabled takes precedence over csrfEnabled=false (no cookie either)', async () => {
      const mw = buildMiddleware({
        ...defaultOptions,
        authMode: 'disabled',
        csrfEnabled: false,
      });
      const m = mockRes();
      await mw.use(mockReq({ method: 'GET', path: '/auth/csrf' }), m.res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(m.setHeader).not.toHaveBeenCalled();
    });
  });
});
