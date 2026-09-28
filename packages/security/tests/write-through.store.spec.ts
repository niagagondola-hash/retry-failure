/**
 * WriteThroughSessionStore unit tests (AUTH-11a mode 3).
 *
 * Tests with mocked RedisSessionStore + PostgresSessionStore.
 * Verifies dual-write + read fallback + Redis-down resilience.
 */
import { PostgresSessionStore } from '../src/session-store/postgres.store';
import { RedisSessionStore } from '../src/session-store/redis-session.store';
import { Session } from '../src/session-store/session-store.interface';
import { WriteThroughSessionStore } from '../src/session-store/write-through.store';

function mockSession(): Session {
  return {
    sid: 'wt-sid-123',
    userId: 'user-uuid-1',
    username: 'superadmin',
    roleId: 'role-uuid-101',
    permissionCodes: ['dashboard', 'payment.read'],
    accessToken: 'access.jwt',
    refreshToken: 'refresh.jwt',
    accessExpiresAt: Date.now() + 900_000,
    refreshExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    lastSyncAt: Date.now(),
  };
}

function mockRedis(): jest.Mocked<RedisSessionStore> {
  return {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    touch: jest.fn(),
    updateSync: jest.fn(),
    listActive: jest.fn(),
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  } as unknown as jest.Mocked<RedisSessionStore>;
}

function mockDb(): jest.Mocked<PostgresSessionStore> {
  return {
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    touch: jest.fn(),
    updateSync: jest.fn(),
    listActive: jest.fn(),
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  } as unknown as jest.Mocked<PostgresSessionStore>;
}

describe('WriteThroughSessionStore', () => {
  let store: WriteThroughSessionStore;
  let redis: jest.Mocked<RedisSessionStore>;
  let db: jest.Mocked<PostgresSessionStore>;

  beforeEach(() => {
    redis = mockRedis();
    db = mockDb();
    store = new WriteThroughSessionStore(redis, db);
  });

  describe('get', () => {
    it('returns from Redis on hit', async () => {
      const session = mockSession();
      redis.get.mockResolvedValue(session);
      const result = await store.get('wt-sid-123');
      expect(result).toEqual(session);
      expect(db.get).not.toHaveBeenCalled();
    });

    it('falls back to DB on Redis miss', async () => {
      const session = mockSession();
      redis.get.mockResolvedValue(null);
      db.get.mockResolvedValue(session);
      const result = await store.get('wt-sid-123');
      expect(result).toEqual(session);
      expect(db.get).toHaveBeenCalledWith('wt-sid-123');
    });

    it('caches DB result to Redis on miss', async () => {
      const session = mockSession();
      redis.get.mockResolvedValue(null);
      db.get.mockResolvedValue(session);
      await store.get('wt-sid-123');
      expect(redis.set).toHaveBeenCalledWith('wt-sid-123', session, expect.any(Number));
    });

    it('returns null when both miss', async () => {
      redis.get.mockResolvedValue(null);
      db.get.mockResolvedValue(null);
      const result = await store.get('unknown');
      expect(result).toBeNull();
    });

    it('falls back to DB when Redis throws', async () => {
      const session = mockSession();
      redis.get.mockRejectedValue(new Error('Redis connection refused'));
      db.get.mockResolvedValue(session);
      const result = await store.get('wt-sid-123');
      expect(result).toEqual(session);
    });
  });

  describe('set', () => {
    it('writes to both Redis + DB', async () => {
      const session = mockSession();
      await store.set('wt-sid', session, 3600_000);
      expect(redis.set).toHaveBeenCalledWith('wt-sid', session, 3600_000);
      expect(db.set).toHaveBeenCalledWith('wt-sid', session, 3600_000);
    });

    it('continues DB write when Redis fails', async () => {
      redis.set.mockRejectedValue(new Error('Redis down'));
      await store.set('wt-sid', mockSession(), 3600_000);
      expect(db.set).toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes from both Redis + DB', async () => {
      await store.delete('wt-sid');
      expect(redis.delete).toHaveBeenCalledWith('wt-sid');
      expect(db.delete).toHaveBeenCalledWith('wt-sid');
    });

    it('continues DB delete when Redis fails', async () => {
      redis.delete.mockRejectedValue(new Error('Redis down'));
      await store.delete('wt-sid');
      expect(db.delete).toHaveBeenCalled();
    });
  });

  describe('touch', () => {
    it('touches both Redis + DB', async () => {
      await store.touch('wt-sid');
      expect(redis.touch).toHaveBeenCalledWith('wt-sid');
      expect(db.touch).toHaveBeenCalledWith('wt-sid');
    });
  });

  describe('updateSync', () => {
    it('updates both Redis + DB', async () => {
      await store.updateSync('wt-sid', ['dashboard'], Date.now());
      expect(redis.updateSync).toHaveBeenCalled();
      expect(db.updateSync).toHaveBeenCalled();
    });
  });

  describe('listActive', () => {
    it('queries DB (authoritative source)', async () => {
      const sessions = [mockSession()];
      db.listActive.mockResolvedValue(sessions);
      const result = await store.listActive();
      expect(result).toEqual(sessions);
      expect(redis.listActive).not.toHaveBeenCalled();
    });
  });

  describe('acquireLock', () => {
    it('delegates to Redis', async () => {
      redis.acquireLock.mockResolvedValue(true);
      const result = await store.acquireLock('sync:lock:wt-sid', 10);
      expect(result).toBe(true);
      expect(redis.acquireLock).toHaveBeenCalledWith('sync:lock:wt-sid', 10);
    });

    it('returns false when Redis fails', async () => {
      redis.acquireLock.mockRejectedValue(new Error('Redis down'));
      const result = await store.acquireLock('sync:lock:wt-sid', 10);
      expect(result).toBe(false);
    });
  });

  describe('releaseLock', () => {
    it('delegates to Redis', async () => {
      await store.releaseLock('sync:lock:wt-sid');
      expect(redis.releaseLock).toHaveBeenCalledWith('sync:lock:wt-sid');
    });

    it('does not throw when Redis fails', async () => {
      redis.releaseLock.mockRejectedValue(new Error('Redis down'));
      await expect(store.releaseLock('key')).resolves.not.toThrow();
    });
  });
});
