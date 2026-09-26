/**
 * HelmetMiddleware unit tests (AUTH-15).
 *
 * Plan reference: PLAN2 Section 12.4 (Security headers / Helmet),
 * OWASP Secure Headers Project, AUTH-15 task spec §8.
 *
 * Tests verify that `HelmetMiddleware.use()` delegates to `helmet()` and
 * causes the underlying `helmet()` RequestHandler to call `res.setHeader`
 * with the 6 expected security headers per plan2 §12.4:
 *   1. Strict-Transport-Security — max-age=31536000; includeSubDomains; preload
 *   2. X-Content-Type-Options — nosniff
 *   3. X-Frame-Options — DENY
 *   4. Content-Security-Policy — default-src 'self'; frame-ancestors 'none';
 *      form-action 'self'; base-uri 'self'
 *   5. Referrer-Policy — strict-origin-when-cross-origin
 *   6. Permissions-Policy — camera=(), microphone=(), geolocation=(), payment=()
 *
 * Approach: HelmetMiddleware delegates to the real `helmet()` factory in its
 * constructor. We pass mock Express req/res objects to `use()` and spy on
 * `res.setHeader`. Helmet internally calls `res.setHeader(headerName, value)`
 * for each header — we assert the 6 headers we configured are present.
 *
 * Note: Node.js HTTP header names are case-insensitive (lowercased internally),
 * but helmet v8 uses conventional casing in `setHeader` calls. We compare
 * case-insensitively to be robust against minor helmet version differences.
 */
import type { NextFunction, Request, Response } from 'express';

import { HelmetMiddleware } from '../src/middleware/helmet.middleware';

/** Build a mock Express Request. Helmet reads req.headers + req.socket. */
function mockReq(): Request {
  return {
    method: 'GET',
    path: '/',
    headers: {},
    socket: {
      encrypted: false,
      remoteAddress: '127.0.0.1',
    },
  } as unknown as Request;
}

/** Build a mock Express Response capturing setHeader + removeHeader. */
function mockRes(): {
  res: Response;
  setHeader: jest.Mock;
  removeHeader: jest.Mock;
  headers: Record<string, string>;
} {
  const headers: Record<string, string> = {};
  const setHeader = jest.fn((name: string, value: string) => {
    headers[name.toLowerCase()] = String(value);
  });
  const removeHeader = jest.fn((name: string) => {
    delete headers[name.toLowerCase()];
  });
  const res = {
    setHeader,
    removeHeader,
    getHeader: (name: string) => headers[name.toLowerCase()],
    headers,
  } as unknown as Response;
  return { res, setHeader, removeHeader, headers };
}

describe('HelmetMiddleware', () => {
  let middleware: HelmetMiddleware;

  beforeEach(() => {
    middleware = new HelmetMiddleware();
  });

  describe('use()', () => {
    it('calls next() so the request can continue', () => {
      const req = mockReq();
      const { res } = mockRes();
      const next: NextFunction = jest.fn();

      middleware.use(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('calls res.setHeader (helmet active — headers were written)', () => {
      const req = mockReq();
      const { res, setHeader } = mockRes();
      const next: NextFunction = jest.fn();

      middleware.use(req, res, next);

      expect(setHeader).toHaveBeenCalled();
    });
  });

  describe('header: Strict-Transport-Security', () => {
    it('sets HSTS header with max-age=31536000 (1 year)', () => {
      const req = mockReq();
      const { res, headers } = mockRes();
      middleware.use(req, res, jest.fn());

      const hsts = headers['strict-transport-security'];
      expect(hsts).toBeDefined();
      expect(hsts).toContain('max-age=31536000');
    });

    it('includes includeSubDomains', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['strict-transport-security']).toContain(
        'includeSubDomains',
      );
    });

    it('includes preload', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['strict-transport-security']).toContain('preload');
    });
  });

  describe('header: X-Content-Type-Options', () => {
    it('sets "nosniff"', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('header: X-Frame-Options', () => {
    it('sets "DENY"', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['x-frame-options']).toBe('DENY');
    });
  });

  describe('header: Content-Security-Policy', () => {
    it('is set (CSP active)', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['content-security-policy']).toBeDefined();
    });

    it('contains default-src \'self\'', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['content-security-policy']).toContain(
        "default-src 'self'",
      );
    });

    it('contains frame-ancestors \'none\'', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['content-security-policy']).toContain(
        "frame-ancestors 'none'",
      );
    });

    it('contains form-action \'self\'', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['content-security-policy']).toContain(
        "form-action 'self'",
      );
    });

    it('contains base-uri \'self\'', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['content-security-policy']).toContain(
        "base-uri 'self'",
      );
    });
  });

  describe('header: Referrer-Policy', () => {
    it('sets "strict-origin-when-cross-origin"', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['referrer-policy']).toBe(
        'strict-origin-when-cross-origin',
      );
    });
  });

  describe('header: Permissions-Policy', () => {
    it('is set', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['permissions-policy']).toBeDefined();
    });

    it('restricts camera=()', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['permissions-policy']).toContain('camera=()');
    });

    it('restricts microphone=()', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['permissions-policy']).toContain('microphone=()');
    });

    it('restricts geolocation=()', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['permissions-policy']).toContain('geolocation=()');
    });

    it('restricts payment=()', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      expect(headers['permissions-policy']).toContain('payment=()');
    });
  });

  describe('all 6 headers together', () => {
    it('sets all 6 expected security headers in a single use() call', () => {
      const { res, headers } = mockRes();
      middleware.use(mockReq(), res, jest.fn());

      // The 6 headers per plan2 §12.4
      expect(headers['strict-transport-security']).toBeDefined();
      expect(headers['x-content-type-options']).toBeDefined();
      expect(headers['x-frame-options']).toBeDefined();
      expect(headers['content-security-policy']).toBeDefined();
      expect(headers['referrer-policy']).toBeDefined();
      expect(headers['permissions-policy']).toBeDefined();
    });
  });
});
