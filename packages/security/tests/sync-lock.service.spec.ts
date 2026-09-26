/**
 * SyncLockService unit tests (AUTH-14).
 *
 * Plan reference: PLAN2 Section 8.3 (lock per sesi), AUTH-14 task spec §2 + §8.
 *
 * Verifies:
 *   - `acquireLock(sid, ttlSec)` delegates to `SessionStore.acquireLock('sync:lock:<sid>', ttlSec)`
 *   - returns `true` when the underlying store acquires the lock
 *   - returns `false` when the underlying store reports the lock is held
 *   - `releaseLock(sid)` delegates to `SessionStore.releaseLock('sync:lock:<sid>')`
 *   - default TTL is applied when ttlSec omitted
 */
import { Test } from '@nestjs/testing';

import { SESSION_STORE, SessionStore } from '../src/session-store';
import { SyncLockService } from '../src/sync/sync-lock.service';

/** Build a fully-mocked SessionStore — only `acquireLock` + `releaseLock` matter here. */
function mockSessionStore(): jest.Mocked<Pick<SessionStore, 'acquireLock' | 'releaseLock'>> & {
  [k: string]: unknown;
} {
  return {
    acquireLock: jest.fn(),
    releaseLock: jest.fn().mockResolvedValue(undefined),
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    touch: jest.fn(),
    updateSync: jest.fn(),
    listActive: jest.fn(),
  } as unknown as jest.Mocked<SessionStore> & { [k: string]: unknown };
}

describe('SyncLockService', () => {
  let svc: SyncLockService;
  let store: ReturnType<typeof mockSessionStore>;

  beforeEach(async () => {
    store = mockSessionStore();
    const mod = await Test.createTestingModule({
      providers: [
        SyncLockService,
        { provide: SESSION_STORE, useValue: store },
      ],
    }).compile();
    svc = mod.get(SyncLockService);
  });

  describe('acquireLock', () => {
    it('delegates to SessionStore.acquireLock with sync:lock:<sid> key + ttlSec', async () => {
      store.acquireLock.mockResolvedValue(true);
      const result = await svc.acquireLock('sid-123', 15);
      expect(result).toBe(true);
      expect(store.acquireLock).toHaveBeenCalledWith('sync:lock:sid-123', 15);
    });

    it('returns true when underlying store acquires the lock', async () => {
      store.acquireLock.mockResolvedValue(true);
      const result = await svc.acquireLock('sid-123');
      expect(result).toBe(true);
    });

    it('returns false when underlying store reports lock already held', async () => {
      store.acquireLock.mockResolvedValue(false);
      const result = await svc.acquireLock('sid-123');
      expect(result).toBe(false);
    });

    it('applies default TTL of 10 seconds when ttlSec omitted', async () => {
      store.acquireLock.mockResolvedValue(true);
      await svc.acquireLock('sid-xyz');
      expect(store.acquireLock).toHaveBeenCalledWith('sync:lock:sid-xyz', 10);
    });
  });

  describe('releaseLock', () => {
    it('delegates to SessionStore.releaseLock with sync:lock:<sid> key', async () => {
      await svc.releaseLock('sid-123');
      expect(store.releaseLock).toHaveBeenCalledWith('sync:lock:sid-123');
    });

    it('resolves even when store.releaseLock resolves undefined', async () => {
      store.releaseLock.mockResolvedValue(undefined);
      await expect(svc.releaseLock('sid-123')).resolves.toBeUndefined();
    });
  });
});
