/**
 * SessionGuard unit tests (AUTH-13).
 *
 * Plan reference: AUTH-13 task spec §7, PLAN2 §6.3, §9.2, §14.6.
 *
 * Tests SessionGuard with mocked SessionService + CacheRepository + Reflector.
 */
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { CacheRepository } from '../src/cache/cache.repository';
import { CachedUser } from '../src/cache/cached-user.entity';
import { IS_PUBLIC_KEY } from '../src/decorators/public.decorator';
import { SessionGuard } from '../src/guards/session.guard';
import { SessionService } from '../src/oauth/session.service';
import { Session } from '../src/session-store';

/** Build a mock execution context with request object. */
function mockExecutionContext(req: {
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
  user?: unknown;
} = {}): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

/** Build a mock session record. */
function mockSession(overrides: Partial<Session> = {}): Session {
  return {
    sid: 'test-sid-123',
    userId: 'user-uuid-1',
    username: 'budi_santoso',
    roleId: 'role-uuid-102',
    permissionCodes: ['dashboard', 'payment.read'],
    accessToken: 'access.jwt',
    idToken: 'id-token.jwt',
    refreshToken: 'refresh.jwt',
    accessExpiresAt: Date.now() + 900_000,
    refreshExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    lastSyncAt: Date.now(),
    ...overrides,
  };
}

describe('SessionGuard', () => {
  let guard: SessionGuard;
  let sessionService: { get: jest.Mock; touch: jest.Mock };
  let cacheRepository: { findCachedUser: jest.Mock };
  let reflector: Reflector;

  beforeEach(() => {
    sessionService = {
      get: jest.fn(),
      touch: jest.fn().mockResolvedValue(undefined),
    };
    cacheRepository = { findCachedUser: jest.fn() };
    reflector = new Reflector();
    guard = new SessionGuard(
      sessionService as unknown as SessionService,
      cacheRepository as unknown as CacheRepository,
      reflector,
      {
        authMode: 'mock',
        sessionStore: 'memory',
      },
    );
  });

  describe('AUTH_MODE=disabled', () => {
    it('sets req.user from env and returns true (skip auth)', async () => {
      process.env.AUTH_DISABLED_USER_ID = 'disabled-uuid';
      process.env.AUTH_DISABLED_USERNAME = 'disabled-user';
      guard = new SessionGuard(
        sessionService as unknown as SessionService,
        cacheRepository as unknown as CacheRepository,
        reflector,
        { authMode: 'disabled', sessionStore: 'memory' },
      );
      const ctx = mockExecutionContext({});
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
      const req = ctx.switchToHttp().getRequest();
      expect(req.user).toBeDefined();
      expect(req.user.userId).toBe('disabled-uuid');
      expect(req.user.username).toBe('disabled-user');
      delete process.env.AUTH_DISABLED_USER_ID;
      delete process.env.AUTH_DISABLED_USERNAME;
    });
  });

  describe('@Public() decorator', () => {
    it('returns true without reading cookie', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
      // Marked as public
      (reflector.getAllAndOverride as jest.Mock).mockImplementation((key) =>
        key === IS_PUBLIC_KEY ? true : undefined,
      );
      const ctx = mockExecutionContext({}); // no cookie
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
      expect(sessionService.get).not.toHaveBeenCalled();
    });
  });

  describe('missing cookie sid', () => {
    it('throws 401 Unauthorized', async () => {
      const ctx = mockExecutionContext({ headers: {} });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Missing session cookie',
      );
    });
  });

  describe('session not found / expired', () => {
    it('throws 401 when session service returns null', async () => {
      sessionService.get.mockResolvedValue(null);
      const ctx = mockExecutionContext({
        cookies: { sid: 'invalid-sid' },
      });
      await expect(guard.canActivate(ctx)).rejects.toThrow(
        'Invalid or expired session',
      );
    });
  });

  describe('valid session', () => {
    it('sets req.user from session + cached_users, touches session, returns true', async () => {
      const session = mockSession();
      const cached: Partial<CachedUser> = {
        is_super_admin: true,
      };
      sessionService.get.mockResolvedValue(session);
      cacheRepository.findCachedUser.mockResolvedValue(cached);

      const ctx = mockExecutionContext({
        cookies: { sid: 'test-sid-123' },
      });
      const result = await guard.canActivate(ctx);
      expect(result).toBe(true);
      expect(sessionService.get).toHaveBeenCalledWith('test-sid-123');
      expect(sessionService.touch).toHaveBeenCalledWith('test-sid-123');
      const req = ctx.switchToHttp().getRequest();
      expect(req.user).toEqual({
        userId: 'user-uuid-1',
        username: 'budi_santoso',
        roleId: 'role-uuid-102',
        isSuperAdmin: true, // from cached_users
        permissionCodes: ['dashboard', 'payment.read'],
      });
    });

    it('sets isSuperAdmin=false when cached user not found', async () => {
      const session = mockSession();
      sessionService.get.mockResolvedValue(session);
      cacheRepository.findCachedUser.mockResolvedValue(null);

      const ctx = mockExecutionContext({
        cookies: { sid: 'test-sid-123' },
      });
      await guard.canActivate(ctx);
      const req = ctx.switchToHttp().getRequest();
      expect(req.user.isSuperAdmin).toBe(false);
    });

    it('sets isSuperAdmin=false when cached.is_super_admin=false', async () => {
      const session = mockSession();
      const cached: Partial<CachedUser> = { is_super_admin: false };
      sessionService.get.mockResolvedValue(session);
      cacheRepository.findCachedUser.mockResolvedValue(cached);

      const ctx = mockExecutionContext({
        cookies: { sid: 'test-sid-123' },
      });
      await guard.canActivate(ctx);
      const req = ctx.switchToHttp().getRequest();
      expect(req.user.isSuperAdmin).toBe(false);
    });

    it('falls back to manual Cookie header parsing when cookies object not set', async () => {
      const session = mockSession();
      sessionService.get.mockResolvedValue(session);
      cacheRepository.findCachedUser.mockResolvedValue(null);

      const ctx = mockExecutionContext({
        headers: { cookie: 'sid=from-header-sid; other=val' },
      });
      await guard.canActivate(ctx);
      expect(sessionService.get).toHaveBeenCalledWith('from-header-sid');
    });
  });
});
