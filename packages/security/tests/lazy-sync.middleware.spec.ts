/**
 * LazySyncMiddleware unit tests (AUTH-14).
 *
 * Plan reference: PLAN2 Section 8.2 (alur lazy sync), Section 8.3 (lock per sesi),
 * Section 8.7 (grace period), Section 14.6 (disabled mode), AUTH-14 task spec §6.
 *
 * Tests the 4-tier SWR flow with mocked SessionStore + AuthSyncService +
 * SyncLockService. All scenarios verify `next()` is called exactly once and
 * the correct sync branch is taken.
 */
import { NextFunction, Request, Response } from 'express';

import { LazySyncMiddleware } from '../src/middleware/lazy-sync.middleware';
import type { SecurityOptions } from '../src/security.module';
import {
  Session,
  SessionStore,
} from '../src/session-store';
import { AuthSyncService } from '../src/sync/auth-sync.service';
import { SyncLockService } from '../src/sync/sync-lock.service';

/** Default TTLs used by the middleware when SecurityOptions omits overrides. */
const FRESH_TTL_MS = 5 * 60 * 1000; // 5 min
const STALE_TTL_MS = 30 * 60 * 1000; // 30 min
const MAX_STALE_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const BLOCKING_TIMEOUT_MS = 2_000;

/** Build a mock Session record. */
function mockSession(lastSyncAt: number): Session {
  return {
    sid: 's'.repeat(64),
    userId: 'user-uuid-1',
    username: 'budi_santoso',
    roleId: 'role-uuid-102',
    permissionCodes: ['dashboard'],
    accessToken: 'access.jwt',
    idToken: 'id-token.jwt',
    refreshToken: 'refresh.jwt',
    accessExpiresAt: Date.now() + 900_000,
    refreshExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    lastSyncAt,
  };
}

/** Build a mock Express Request with `cookies` set. */
function mockReq(opts: { sid?: string } = {}): Request {
  const req = { cookies: {} } as unknown as Request;
  if (opts.sid !== undefined) {
    (req as unknown as { cookies: Record<string, string> }).cookies = {
      sid: opts.sid,
    };
  }
  return req;
}

/** Build mocks for the 3 collaborators. */
function buildMocks() {
  const store: jest.Mocked<SessionStore> = {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn().mockResolvedValue(undefined),
    touch: jest.fn(),
    updateSync: jest.fn().mockResolvedValue(undefined),
    listActive: jest.fn(),
    acquireLock: jest.fn(),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<SessionStore>;

  const syncService: jest.Mocked<Pick<AuthSyncService, 'syncSession'>> = {
    syncSession: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Pick<AuthSyncService, 'syncSession'>>;

  const lockService: jest.Mocked<Pick<SyncLockService, 'acquireLock' | 'releaseLock'>> = {
    acquireLock: jest.fn().mockResolvedValue(true),
    releaseLock: jest.fn().mockResolvedValue(undefined),
  } as unknown as jest.Mocked<Pick<SyncLockService, 'acquireLock' | 'releaseLock'>>;

  return { store, syncService, lockService };
}

/** Wait for the next tick so setImmediate background sync can run. */
function flushBackground(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe('LazySyncMiddleware', () => {
  let store: jest.Mocked<SessionStore>;
  let syncService: jest.Mocked<Pick<AuthSyncService, 'syncSession'>>;
  let lockService: jest.Mocked<Pick<SyncLockService, 'acquireLock' | 'releaseLock'>>;
  let middleware: LazySyncMiddleware;
  const next: NextFunction = jest.fn();
  const res = {} as Response;
  const options: SecurityOptions = {
    authMode: 'oauth',
    sessionStore: 'memory',
  };

  beforeEach(() => {
    ({ store, syncService, lockService } = buildMocks());
    (next as jest.Mock).mockClear();
    middleware = new LazySyncMiddleware(
      store,
      syncService as unknown as AuthSyncService,
      lockService as unknown as SyncLockService,
      options,
    );
  });

  describe('AUTH_MODE=disabled', () => {
    it('skips entirely — no session lookup, no sync, next() called', async () => {
      const disabled = new LazySyncMiddleware(
        store,
        syncService as unknown as AuthSyncService,
        lockService as unknown as SyncLockService,
        { authMode: 'disabled', sessionStore: 'memory' },
      );
      await disabled.use(mockReq({ sid: 'any-sid' }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(store.get).not.toHaveBeenCalled();
      expect(syncService.syncSession).not.toHaveBeenCalled();
    });
  });

  describe('no sid cookie', () => {
    it('calls next() without session lookup', async () => {
      await middleware.use(mockReq({}), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(store.get).not.toHaveBeenCalled();
    });
  });

  describe('session not found', () => {
    it('calls next() without triggering sync (SessionGuard handles 401)', async () => {
      store.get.mockResolvedValue(null);
      await middleware.use(mockReq({ sid: 'unknown-sid' }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(syncService.syncSession).not.toHaveBeenCalled();
    });
  });

  describe('fresh (age < 5 min)', () => {
    it('calls next() without any sync', async () => {
      const session = mockSession(Date.now() - 60_000); // 1 min ago
      store.get.mockResolvedValue(session);
      await middleware.use(mockReq({ sid: session.sid }), res, next);
      expect(next).toHaveBeenCalledTimes(1);
      expect(syncService.syncSession).not.toHaveBeenCalled();
      expect(lockService.acquireLock).not.toHaveBeenCalled();
    });
  });

  describe('stale (5 min ≤ age < 30 min) — background sync', () => {
    it('triggers background sync and calls next() immediately (non-blocking)', async () => {
      const session = mockSession(Date.now() - 10 * 60 * 1000); // 10 min ago
      store.get.mockResolvedValue(session);
      const start = Date.now();
      await middleware.use(mockReq({ sid: session.sid }), res, next);
      const elapsed = Date.now() - start;
      expect(next).toHaveBeenCalledTimes(1);
      // next() should be called quickly — sync is fire-and-forget via setImmediate
      expect(elapsed).toBeLessThan(500);

      // Wait for background sync to settle
      await flushBackground();
      expect(syncService.syncSession).toHaveBeenCalledTimes(1);
      expect(lockService.acquireLock).toHaveBeenCalledWith(
        session.sid,
        10, // default lockTtlSec
      );
      expect(lockService.releaseLock).toHaveBeenCalledWith(session.sid);
    });

    it('background sync error does NOT propagate (caught + logged)', async () => {
      const session = mockSession(Date.now() - 10 * 60 * 1000);
      store.get.mockResolvedValue(session);
      syncService.syncSession.mockRejectedValue(new Error('auth down'));

      await middleware.use(mockReq({ sid: session.sid }), res, next);
      await flushBackground();

      expect(next).toHaveBeenCalledTimes(1);
      // background error should not throw — the await should not reject
      expect(syncService.syncSession).toHaveBeenCalledTimes(1);
      // lock should still be released in the finally block
      expect(lockService.releaseLock).toHaveBeenCalledWith(session.sid);
    });

    it('releases lock in finally even when sync throws', async () => {
      const session = mockSession(Date.now() - 10 * 60 * 1000);
      store.get.mockResolvedValue(session);
      syncService.syncSession.mockRejectedValue(new Error('boom'));

      await middleware.use(mockReq({ sid: session.sid }), res, next);
      await flushBackground();

      expect(lockService.releaseLock).toHaveBeenCalledTimes(1);
    });
  });

  describe('very stale (30 min ≤ age < 2h) — blocking sync', () => {
    it('awaits sync before calling next() (blocking)', async () => {
      const session = mockSession(Date.now() - 45 * 60 * 1000); // 45 min ago
      store.get.mockResolvedValue(session);
      let syncResolved = false;
      syncService.syncSession.mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 50));
        syncResolved = true;
        return { permissionCodes: [], user: undefined as never };
      });

      await middleware.use(mockReq({ sid: session.sid }), res, next);

      expect(syncResolved).toBe(true);
      expect(next).toHaveBeenCalledTimes(1);
      expect(lockService.acquireLock).toHaveBeenCalledWith(session.sid, 10);
      expect(lockService.releaseLock).toHaveBeenCalledWith(session.sid);
    });

    it('uses stale cache when sync times out — logs warning + next()', async () => {
      const session = mockSession(Date.now() - 45 * 60 * 1000);
      store.get.mockResolvedValue(session);
      // Build a middleware with very short blocking timeout for the test
      const fastMiddleware = new LazySyncMiddleware(
        store,
        syncService as unknown as AuthSyncService,
        lockService as unknown as SyncLockService,
        { ...options, syncBlockingTimeoutMs: 30 },
      );
      syncService.syncSession.mockImplementation(
        () => new Promise(() => {
          /* never resolves */
        }),
      );

      const start = Date.now();
      await fastMiddleware.use(mockReq({ sid: session.sid }), res, next);
      const elapsed = Date.now() - start;

      expect(next).toHaveBeenCalledTimes(1);
      expect(elapsed).toBeGreaterThanOrEqual(25);
      expect(elapsed).toBeLessThan(2_000); // Should not block 2s default
    });

    it('uses stale cache when sync throws — logs warning + next()', async () => {
      const session = mockSession(Date.now() - 45 * 60 * 1000);
      store.get.mockResolvedValue(session);
      syncService.syncSession.mockRejectedValue(new Error('auth down'));

      await middleware.use(mockReq({ sid: session.sid }), res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(syncService.syncSession).toHaveBeenCalledTimes(1);
    });

    it('releases lock in finally even when blocking sync throws', async () => {
      const session = mockSession(Date.now() - 45 * 60 * 1000);
      store.get.mockResolvedValue(session);
      syncService.syncSession.mockRejectedValue(new Error('boom'));

      await middleware.use(mockReq({ sid: session.sid }), res, next);

      expect(lockService.releaseLock).toHaveBeenCalledWith(session.sid);
    });

    it('does NOT call syncSession when lock is held by another process', async () => {
      const session = mockSession(Date.now() - 45 * 60 * 1000);
      store.get.mockResolvedValue(session);
      lockService.acquireLock.mockResolvedValue(false);

      await middleware.use(mockReq({ sid: session.sid }), res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(syncService.syncSession).not.toHaveBeenCalled();
      // No releaseLock call since we never acquired
      expect(lockService.releaseLock).not.toHaveBeenCalled();
    });
  });

  describe('max stale (age ≥ 2h) — invalidate session', () => {
    it('deletes session via store.delete + calls next() (SessionGuard will 401)', async () => {
      const session = mockSession(Date.now() - 3 * 60 * 60 * 1000); // 3h ago
      store.get.mockResolvedValue(session);

      await middleware.use(mockReq({ sid: session.sid }), res, next);

      expect(store.delete).toHaveBeenCalledWith(session.sid);
      expect(next).toHaveBeenCalledTimes(1);
      expect(syncService.syncSession).not.toHaveBeenCalled();
      expect(lockService.acquireLock).not.toHaveBeenCalled();
    });
  });

  describe('TTL boundary conditions', () => {
    it('treats age == freshTtl as stale (background sync)', async () => {
      // age exactly at FRESH_TTL → falls into the stale branch
      const session = mockSession(Date.now() - FRESH_TTL_MS);
      store.get.mockResolvedValue(session);

      await middleware.use(mockReq({ sid: session.sid }), res, next);
      await flushBackground();

      expect(syncService.syncSession).toHaveBeenCalledTimes(1);
    });

    it('treats age == staleTtl as blocking sync', async () => {
      const session = mockSession(Date.now() - STALE_TTL_MS);
      store.get.mockResolvedValue(session);

      await middleware.use(mockReq({ sid: session.sid }), res, next);

      expect(syncService.syncSession).toHaveBeenCalledTimes(1);
      expect(lockService.acquireLock).toHaveBeenCalledTimes(1);
    });

    it('treats age == maxStaleTtl as invalidate', async () => {
      const session = mockSession(Date.now() - MAX_STALE_TTL_MS);
      store.get.mockResolvedValue(session);

      await middleware.use(mockReq({ sid: session.sid }), res, next);

      expect(store.delete).toHaveBeenCalledWith(session.sid);
      expect(syncService.syncSession).not.toHaveBeenCalled();
    });
  });

  describe('custom TTLs from SecurityOptions', () => {
    it('respects custom syncFreshTtlMs', async () => {
      const customMiddleware = new LazySyncMiddleware(
        store,
        syncService as unknown as AuthSyncService,
        lockService as unknown as SyncLockService,
        { ...options, syncFreshTtlMs: 100 },
      );
      const session = mockSession(Date.now() - 500); // 500ms ago — fresh under default but stale under 100ms
      store.get.mockResolvedValue(session);

      await customMiddleware.use(mockReq({ sid: session.sid }), res, next);
      await flushBackground();

      expect(syncService.syncSession).toHaveBeenCalledTimes(1);
    });

    it('respects custom syncBlockingTimeoutMs', async () => {
      const customMiddleware = new LazySyncMiddleware(
        store,
        syncService as unknown as AuthSyncService,
        lockService as unknown as SyncLockService,
        { ...options, syncBlockingTimeoutMs: 20 },
      );
      const session = mockSession(Date.now() - 45 * 60 * 1000);
      store.get.mockResolvedValue(session);
      syncService.syncSession.mockImplementation(
        () => new Promise(() => {
          /* never resolves */
        }),
      );

      const start = Date.now();
      await customMiddleware.use(mockReq({ sid: session.sid }), res, next);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeLessThan(BLOCKING_TIMEOUT_MS);
    });

    it('respects custom syncLockTtlSec', async () => {
      const customMiddleware = new LazySyncMiddleware(
        store,
        syncService as unknown as AuthSyncService,
        lockService as unknown as SyncLockService,
        { ...options, syncLockTtlSec: 99 },
      );
      const session = mockSession(Date.now() - 45 * 60 * 1000);
      store.get.mockResolvedValue(session);

      await customMiddleware.use(mockReq({ sid: session.sid }), res, next);

      expect(lockService.acquireLock).toHaveBeenCalledWith(session.sid, 99);
    });
  });
});
