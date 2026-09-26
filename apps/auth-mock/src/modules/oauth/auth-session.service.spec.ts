/**
 * AuthSessionService unit tests (AUTH-04).
 *
 * Verifies cookie create/read/destroy + TTL + cookie attributes.
 *
 * Plan reference: AUTH-04 task spec §6, PLAN2 §10.7.9.
 */
import { Test } from '@nestjs/testing';
import { Response, Request } from 'express';

import { MockUser } from '../user/user.service';

import { AuthSessionService, AUTH_SID_COOKIE } from './auth-session.service';

/** Build a mock Response that captures cookie() + clearCookie() calls. */
function mockResponse(): Response & {
  cookies: Record<string, { value: string; options: Record<string, unknown> }>;
  clearedCookies: string[];
} {
  const cookies: Record<string, { value: string; options: Record<string, unknown> }> = {};
  const clearedCookies: string[] = [];
  return {
    cookies,
    clearedCookies,
    cookie(name: string, value: string, options: Record<string, unknown>) {
      cookies[name] = { value, options };
      return this as unknown as Response;
    },
    clearCookie(name: string) {
      clearedCookies.push(name);
      return this as unknown as Response;
    },
  } as unknown as Response & {
    cookies: typeof cookies;
    clearedCookies: typeof clearedCookies;
  };
}

/** Build a mock Request with cookies parsed from a Set-Cookie-like string. */
function mockRequest(cookies: Record<string, string> = {}): Request {
  return { cookies } as unknown as Request;
}

/** Build a fake MockUser for test. */
function mockUser(): MockUser {
  return {
    id: '00000000-0000-1000-8000-000000000002',
    username: 'budi_santoso',
    passwordHash: 'ChangeMe_123!',
    name: 'Budi Santoso',
    isSuperAdmin: false,
    roles: [],
  };
}

describe('AuthSessionService', () => {
  let svc: AuthSessionService;

  beforeEach(async () => {
    const mod = await Test.createTestingModule({
      providers: [AuthSessionService],
    }).compile();
    svc = mod.get(AuthSessionService);
  });

  describe('create', () => {
    it('creates a session + sets auth_sid cookie', async () => {
      const res = mockResponse();
      const user = mockUser();
      const sid = await svc.create(res, user);

      expect(sid).toBeDefined();
      expect(sid).toHaveLength(64); // 32 bytes hex = 64 chars
      expect(res.cookies[AUTH_SID_COOKIE]).toBeDefined();
      expect(res.cookies[AUTH_SID_COOKIE].value).toBe(sid);
    });

    it('sets HttpOnly + SameSite=Lax + Path=/ + Max-Age=3600', async () => {
      const res = mockResponse();
      await svc.create(res, mockUser());

      const opts = res.cookies[AUTH_SID_COOKIE].options;
      expect(opts.httpOnly).toBe(true);
      expect(opts.sameSite).toBe('lax');
      expect(opts.path).toBe('/');
      // Max-Age=3600000 ms = 1 hour
      expect(opts.maxAge).toBe(3_600_000);
    });

    it('does NOT set Secure flag in dev (AUTH_MOCK_TLS != on)', async () => {
      const res = mockResponse();
      delete process.env.AUTH_MOCK_TLS;
      await svc.create(res, mockUser());
      expect(res.cookies[AUTH_SID_COOKIE].options.secure).toBe(false);
    });

    it('sets Secure=true when AUTH_MOCK_TLS=on', async () => {
      process.env.AUTH_MOCK_TLS = 'on';
      const res = mockResponse();
      await svc.create(res, mockUser());
      expect(res.cookies[AUTH_SID_COOKIE].options.secure).toBe(true);
      delete process.env.AUTH_MOCK_TLS;
    });

    it('returns unique sid per call', async () => {
      const res1 = mockResponse();
      const res2 = mockResponse();
      const sid1 = await svc.create(res1, mockUser());
      const sid2 = await svc.create(res2, mockUser());
      expect(sid1).not.toBe(sid2);
    });
  });

  describe('get', () => {
    it('returns null when no cookie present', async () => {
      const req = mockRequest({});
      const session = await svc.get(req);
      expect(session).toBeNull();
    });

    it('returns null when sid is not in sessions map', async () => {
      const req = mockRequest({ [AUTH_SID_COOKIE]: 'invalid-sid' });
      const session = await svc.get(req);
      expect(session).toBeNull();
    });

    it('returns session after create', async () => {
      const res = mockResponse();
      const user = mockUser();
      const sid = await svc.create(res, user);

      const req = mockRequest({ [AUTH_SID_COOKIE]: sid });
      const session = await svc.get(req);
      expect(session).not.toBeNull();
      expect(session!.userId).toBe(user.id);
      expect(session!.username).toBe(user.username);
      expect(session!.user).toBe(user);
    });

    it('returns null for expired session', async () => {
      const res = mockResponse();
      const user = mockUser();
      // Create session
      const sid = await svc.create(res, user);
      // Manually expire by setting expiresAt to past
      // Access internal map via reflection (test-only)
      const internal = svc as unknown as { sessions: Map<string, { expiresAt: number }> };
      const sess = internal.sessions.get(sid);
      if (sess) sess.expiresAt = Date.now() - 1000;

      const req = mockRequest({ [AUTH_SID_COOKIE]: sid });
      const result = await svc.get(req);
      expect(result).toBeNull();
      // Expired session should be deleted from map
      expect(internal.sessions.has(sid)).toBe(false);
    });
  });

  describe('destroy', () => {
    it('clears cookie on response', async () => {
      const res = mockResponse();
      await svc.destroy(res);
      expect(res.clearedCookies).toContain(AUTH_SID_COOKIE);
    });

    it('deletes session by sid when provided', async () => {
      const createRes = mockResponse();
      const sid = await svc.create(createRes, mockUser());

      // Verify session exists
      const internal = svc as unknown as { sessions: Map<string, unknown> };
      expect(internal.sessions.has(sid)).toBe(true);

      // Destroy by sid
      const destroyRes = mockResponse();
      await svc.destroy(destroyRes, sid);
      expect(internal.sessions.has(sid)).toBe(false);
    });
  });

  describe('onModuleDestroy', () => {
    it('clears all timers + sessions without throwing', async () => {
      const res = mockResponse();
      await svc.create(res, mockUser());
      await svc.create(res, mockUser());
      await svc.create(res, mockUser());

      // Should not throw
      expect(() => svc.onModuleDestroy()).not.toThrow();

      // All sessions cleared
      const internal = svc as unknown as { sessions: Map<string, unknown>; timers: Set<unknown> };
      expect(internal.sessions.size).toBe(0);
      expect(internal.timers.size).toBe(0);
    });
  });

  describe('cookieParser integration (E2E shape check)', () => {
    it('cookie name is "auth_sid"', () => {
      expect(AUTH_SID_COOKIE).toBe('auth_sid');
    });

    it('cookie value is 64-char hex (32 bytes)', async () => {
      const res = mockResponse();
      const sid = await svc.create(res, mockUser());
      expect(sid).toMatch(/^[0-9a-f]{64}$/);
    });
  });
});
