/**
 * RedisSessionStore — unit tests with mocked ioredis.
 *
 * Verifies:
 *  - get/set/delete/touch/updateSync/listActive contract
 *  - SCAN-based listActive (not KEYS)
 *  - acquireLock uses SET NX EX (atomic)
 *  - releaseLock uses DEL
 *  - TTL handling (PX ms)
 *  - JSON parse error returns null (does not throw)
 *
 * Plan reference: AUTH-11 acceptance criteria.
 */
import { RedisSessionStore } from '../src/session-store/redis-session.store';
import type { Session } from '../src/session-store/session-store.interface';

type RedisLike = {
  get: jest.Mock;
  set: jest.Mock;
  del: jest.Mock;
  scan: jest.Mock;
  mget: jest.Mock;
  on: jest.Mock;
  quit: jest.Mock;
};

// Stub the `ioredis` module before each test module loads.
jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => {
      return {
        get: jest.fn(),
        set: jest.fn(),
        del: jest.fn(),
        scan: jest.fn(),
        mget: jest.fn(),
        on: jest.fn(),
        quit: jest.fn().mockResolvedValue('OK'),
      } satisfies RedisLike;
    }),
  };
});

// Pull default export after jest.mock applied.
const IORedis = require('ioredis') as { default: jest.Mock };

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    sid: 'sid-1',
    userId: 'user-1',
    username: 'budi_santoso',
    roleId: 'role-1',
    permissionCodes: ['payment.read'],
    accessToken: 'access-token-1',
    idToken: 'id-token.jwt',
    refreshToken: 'refresh-token-1',
    accessExpiresAt: now + 15 * 60 * 1000,
    refreshExpiresAt: now + 8 * 60 * 60 * 1000,
    createdAt: now,
    lastSeenAt: now,
    lastSyncAt: now,
    ...overrides,
  };
}

function getMockRedis(): RedisLike {
  // Each `new Redis(url, opts)` call returns a fresh mock — we want the most recent.
  const last = IORedis.default.mock.results.at(-1)?.value as RedisLike;
  if (!last) throw new Error('Redis was not constructed yet');
  return last;
}

describe('RedisSessionStore', () => {
  let store: RedisSessionStore;

  beforeEach(() => {
    IORedis.default.mockClear();
    store = new RedisSessionStore('redis://localhost:6379');
  });

  afterEach(async () => {
    await store.onModuleDestroy();
  });

  describe('construction + connection', () => {
    it('constructs ioredis with the provided URL', () => {
      expect(IORedis.default).toHaveBeenCalledWith(
        'redis://localhost:6379',
        expect.objectContaining({ enableReadyCheck: true }),
      );
    });

    it('registers error + connect event handlers', () => {
      const redis = getMockRedis();
      expect(redis.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(redis.on).toHaveBeenCalledWith('connect', expect.any(Function));
    });
  });

  describe('get', () => {
    it('returns parsed Session when key exists', async () => {
      const redis = getMockRedis();
      const s = makeSession({ sid: 'sid-x' });
      redis.get.mockResolvedValue(JSON.stringify(s));
      const result = await store.get('sid-x');
      expect(redis.get).toHaveBeenCalledWith('session:sid-x');
      expect(result).toEqual(s);
    });

    it('returns null when key does not exist', async () => {
      const redis = getMockRedis();
      redis.get.mockResolvedValue(null);
      expect(await store.get('missing')).toBeNull();
    });

    it('returns null on JSON parse error (does not throw)', async () => {
      const redis = getMockRedis();
      redis.get.mockResolvedValue('{not valid json');
      expect(await store.get('bad')).toBeNull();
    });
  });

  describe('set', () => {
    it('sets key with PX ttl (milliseconds)', async () => {
      const redis = getMockRedis();
      redis.set.mockResolvedValue('OK');
      const s = makeSession({ sid: 'sid-set' });
      await store.set('sid-set', s, 60_000);
      expect(redis.set).toHaveBeenCalledWith(
        'session:sid-set',
        JSON.stringify(s),
        'PX',
        60_000,
      );
    });

    it('deletes key if ttlMs <= 0 (no dead writes)', async () => {
      const redis = getMockRedis();
      const s = makeSession({ sid: 'sid-dead' });
      await store.set('sid-dead', s, 0);
      expect(redis.del).toHaveBeenCalledWith('session:sid-dead');
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('deletes the session key', async () => {
      const redis = getMockRedis();
      redis.del.mockResolvedValue(1);
      await store.delete('sid-del');
      expect(redis.del).toHaveBeenCalledWith('session:sid-del');
    });
  });

  describe('touch', () => {
    it('updates lastSeenAt + re-sets with refreshed TTL', async () => {
      const redis = getMockRedis();
      const s = makeSession({ sid: 'sid-touch', lastSeenAt: 0 });
      redis.get.mockResolvedValue(JSON.stringify(s));
      redis.set.mockResolvedValue('OK');

      const before = Date.now();
      await store.touch('sid-touch');
      const after = Date.now();

      expect(redis.get).toHaveBeenCalledWith('session:sid-touch');
      expect(redis.set).toHaveBeenCalled();
      const [, body, , ttlMs] = redis.set.mock.calls[0] as [
        string,
        string,
        string,
        number,
      ];
      const parsed = JSON.parse(body) as Session;
      expect(parsed.lastSeenAt).toBeGreaterThanOrEqual(before);
      expect(parsed.lastSeenAt).toBeLessThanOrEqual(after);
      // TTL = refreshExpiresAt - now (clamped to positive)
      expect(ttlMs).toBeGreaterThan(0);
    });

    it('is a no-op when session does not exist', async () => {
      const redis = getMockRedis();
      redis.get.mockResolvedValue(null);
      await store.touch('missing');
      expect(redis.set).not.toHaveBeenCalled();
    });

    it('deletes session when refreshExpiresAt already passed', async () => {
      const redis = getMockRedis();
      const s = makeSession({
        sid: 'sid-expired',
        refreshExpiresAt: Date.now() - 1000,
      });
      redis.get.mockResolvedValue(JSON.stringify(s));
      await store.touch('sid-expired');
      expect(redis.del).toHaveBeenCalledWith('session:sid-expired');
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('updateSync', () => {
    it('updates permissionCodes + lastSyncAt + refreshes TTL', async () => {
      const redis = getMockRedis();
      const s = makeSession({ sid: 'sid-sync', permissionCodes: ['old'] });
      redis.get.mockResolvedValue(JSON.stringify(s));
      redis.set.mockResolvedValue('OK');

      const syncAt = Date.now();
      await store.updateSync('sid-sync', ['payment.read', 'payment.write'], syncAt);

      const [, body] = redis.set.mock.calls[0] as [string, string];
      const parsed = JSON.parse(body) as Session;
      expect(parsed.permissionCodes).toEqual(['payment.read', 'payment.write']);
      expect(parsed.lastSyncAt).toEqual(syncAt);
    });

    it('is a no-op when session does not exist', async () => {
      const redis = getMockRedis();
      redis.get.mockResolvedValue(null);
      await store.updateSync('missing', ['x'], Date.now());
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe('listActive', () => {
    it('uses SCAN (cursor-based) — never KEYS', async () => {
      const redis = getMockRedis();
      // Single-page SCAN: returns cursor '0' + no keys
      redis.scan.mockResolvedValue(['0', []]);
      const result = await store.listActive();
      expect(redis.scan).toHaveBeenCalledWith(
        '0',
        'MATCH',
        'session:*',
        'COUNT',
        100,
      );
      expect(result).toEqual([]);
      // No `keys` method on the mock — proving SCAN, not KEYS, is invoked.
      expect((redis as Record<string, unknown>).keys).toBeUndefined();
    });

    it('paginates via cursor until cursor returns to 0', async () => {
      const redis = getMockRedis();
      const s1 = makeSession({ sid: 's1' });
      const s2 = makeSession({ sid: 's2' });
      redis.scan
        .mockResolvedValueOnce(['abc', ['session:s1']]) // page 1, cursor 'abc'
        .mockResolvedValueOnce(['0', ['session:s2']]); // page 2, cursor '0' (end)
      redis.mget
        .mockResolvedValueOnce([JSON.stringify(s1)])
        .mockResolvedValueOnce([JSON.stringify(s2)]);

      const result = await store.listActive();
      expect(redis.scan).toHaveBeenCalledTimes(2);
      expect(redis.mget).toHaveBeenCalledTimes(2);
      const sids = result.map((s) => s.sid).sort();
      expect(sids).toEqual(['s1', 's2']);
    });

    it('skips malformed entries (JSON parse failure) without throwing', async () => {
      const redis = getMockRedis();
      redis.scan.mockResolvedValueOnce(['0', ['session:bad']]);
      redis.mget.mockResolvedValueOnce(['{invalid']);

      const result = await store.listActive();
      expect(result).toEqual([]);
    });
  });

  describe('acquireLock / releaseLock', () => {
    it('acquireLock returns true when SET NX returns OK', async () => {
      const redis = getMockRedis();
      redis.set.mockResolvedValue('OK');
      const result = await store.acquireLock('test-key', 10);
      expect(redis.set).toHaveBeenCalledWith(
        'lock:test-key',
        '1',
        'EX',
        10,
        'NX',
      );
      expect(result).toBe(true);
    });

    it('acquireLock returns false when SET NX returns null (already held)', async () => {
      const redis = getMockRedis();
      redis.set.mockResolvedValue(null);
      const result = await store.acquireLock('test-key', 10);
      expect(result).toBe(false);
    });

    it('releaseLock calls DEL on lock key', async () => {
      const redis = getMockRedis();
      redis.del.mockResolvedValue(1);
      await store.releaseLock('test-key');
      expect(redis.del).toHaveBeenCalledWith('lock:test-key');
    });
  });

  describe('onModuleDestroy', () => {
    it('calls redis.quit()', async () => {
      const redis = getMockRedis();
      redis.quit.mockResolvedValue('OK');
      await store.onModuleDestroy();
      expect(redis.quit).toHaveBeenCalled();
    });
  });
});
