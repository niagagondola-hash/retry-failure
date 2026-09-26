/**
 * Parity test — runs the same suite of operations against both
 * MemorySessionStore and RedisSessionStore (with mocked ioredis)
 * and asserts identical observable behavior.
 *
 * Plan reference: AUTH-11 acceptance criteria — "Parity test catches drift".
 */
import { MemorySessionStore } from '../src/session-store/memory-session.store';
import { RedisSessionStore } from '../src/session-store/redis-session.store';
import type { Session, SessionStore } from '../src/session-store/session-store.interface';

// Minimal ioredis mock backed by an in-memory Map. Real Redis semantics
// (PX, NX, EX, SCAN) are simulated closely enough for parity assertions.
jest.mock('ioredis', () => {
  return {
    __esModule: true,
    default: jest.fn().mockImplementation(() => {
      const kv = new Map<string, string>();
      const ttlOf = new Map<string, number>(); // unix ms epoch for expiry
      const redis = {
        get: jest.fn(async (key: string) => {
          if ((ttlOf.get(key) ?? Infinity) < Date.now()) {
            kv.delete(key);
            ttlOf.delete(key);
            return null;
          }
          return kv.get(key) ?? null;
        }),
        set: jest.fn(async (...args: unknown[]) => {
          // SET key value [EX seconds | PX ms] [NX]
          const key = args[0] as string;
          const value = args[1] as string;
          const rest = args.slice(2);
          let ttlMs: number | undefined;
          let nx = false;
          for (let i = 0; i < rest.length; i++) {
            const flag = rest[i];
            if (flag === 'PX') ttlMs = rest[i + 1] as number;
            if (flag === 'EX') ttlMs = (rest[i + 1] as number) * 1000;
            if (flag === 'NX') nx = true;
            if (typeof flag === 'string' && ['PX', 'EX', 'NX', 'XX'].includes(flag)) {
              i++; // skip the value paired with a binary flag... except NX/XX (no value)
              // Actually: NX/XX have no value; EX/PX do. We can't blanket-skip.
              // Reset i to handle the right pattern.
            }
          }
          // Re-parse cleanly to avoid the convoluted loop above:
          ttlMs = undefined;
          nx = false;
          for (let i = 0; i < rest.length; i++) {
            const flag = rest[i] as string;
            if (flag === 'PX') {
              ttlMs = rest[i + 1] as number;
              i++;
            } else if (flag === 'EX') {
              ttlMs = (rest[i + 1] as number) * 1000;
              i++;
            } else if (flag === 'NX') {
              nx = true;
            }
          }
          if (nx && kv.has(key)) {
            return null; // NX not satisfied
          }
          kv.set(key, value);
          if (ttlMs !== undefined) {
            ttlOf.set(key, Date.now() + ttlMs);
          } else {
            ttlOf.delete(key);
          }
          return 'OK';
        }),
        del: jest.fn(async (key: string) => {
          const had = kv.delete(key);
          ttlOf.delete(key);
          return had ? 1 : 0;
        }),
        scan: jest.fn(async () => {
          // Single-page SCAN returning all matching keys
          const matching = Array.from(kv.keys()).filter((k) =>
            k.startsWith('session:'),
          );
          return ['0', matching];
        }),
        mget: jest.fn(async (...keys: string[]) => {
          return keys.map((k) => kv.get(k) ?? null);
        }),
        on: jest.fn(),
        quit: jest.fn(async () => 'OK'),
      };
      return redis;
    }),
  };
});

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = Date.now();
  return {
    sid: 'sid-1',
    userId: 'user-1',
    username: 'budi_santoso',
    roleId: 'role-1',
    permissionCodes: ['payment.read'],
    accessToken: 'access-token-1',
    refreshToken: 'refresh-token-1',
    accessExpiresAt: now + 15 * 60 * 1000,
    refreshExpiresAt: now + 8 * 60 * 60 * 1000,
    createdAt: now,
    lastSeenAt: now,
    lastSyncAt: now,
    ...overrides,
  };
}

const factories: Array<[string, () => SessionStore]> = [
  ['MemorySessionStore', () => new MemorySessionStore({ max: 100, lockCleanupMs: 60_000 })],
  ['RedisSessionStore', () => new RedisSessionStore('redis://localhost:6379')],
];

describe.each(factories)('%s parity', (_name, makeStore) => {
  let store: SessionStore;

  beforeEach(() => {
    store = makeStore();
  });

  afterEach(async () => {
    // Both impls expose onModuleDestroy via different signatures; call it if present.
    const anyStore = store as unknown as {
      onModuleDestroy?: () => void | Promise<void>;
    };
    if (typeof anyStore.onModuleDestroy === 'function') {
      await anyStore.onModuleDestroy();
    }
  });

  it('get on missing sid returns null', async () => {
    expect(await store.get('nope')).toBeNull();
  });

  it('set + get roundtrip', async () => {
    const s = makeSession({ sid: 'p-1' });
    await store.set('p-1', s, 60_000);
    const got = await store.get('p-1');
    expect(got).not.toBeNull();
    expect(got?.userId).toEqual('user-1');
  });

  it('delete removes the session', async () => {
    await store.set('p-2', makeSession({ sid: 'p-2' }), 60_000);
    await store.delete('p-2');
    expect(await store.get('p-2')).toBeNull();
  });

  it('touch updates lastSeenAt', async () => {
    const s = makeSession({ sid: 'p-3', lastSeenAt: 0 });
    await store.set('p-3', s, 60_000);
    await store.touch('p-3');
    const got = await store.get('p-3');
    expect(got?.lastSeenAt).toBeGreaterThan(0);
  });

  it('touch on missing sid is no-op', async () => {
    await expect(store.touch('missing')).resolves.toBeUndefined();
  });

  it('updateSync updates permissionCodes + lastSyncAt', async () => {
    await store.set('p-4', makeSession({ sid: 'p-4', permissionCodes: [] }), 60_000);
    const syncAt = Date.now();
    await store.updateSync('p-4', ['payment.read', 'payment.write'], syncAt);
    const got = await store.get('p-4');
    expect(got?.permissionCodes).toEqual(['payment.read', 'payment.write']);
    expect(got?.lastSyncAt).toEqual(syncAt);
  });

  it('listActive returns all stored sessions', async () => {
    await store.set('a', makeSession({ sid: 'a' }), 60_000);
    await store.set('b', makeSession({ sid: 'b' }), 60_000);
    const active = await store.listActive();
    const sids = active.map((s) => s.sid).sort();
    expect(sids).toEqual(['a', 'b']);
  });

  describe('locks', () => {
    it('first acquire true, second false, after release true', async () => {
      expect(await store.acquireLock('lk', 5)).toBe(true);
      expect(await store.acquireLock('lk', 5)).toBe(false);
      await store.releaseLock('lk');
      expect(await store.acquireLock('lk', 5)).toBe(true);
    });

    it('releaseLock on non-held is idempotent', async () => {
      await expect(store.releaseLock('never')).resolves.toBeUndefined();
    });

    it('different keys independent', async () => {
      expect(await store.acquireLock('k1', 5)).toBe(true);
      expect(await store.acquireLock('k2', 5)).toBe(true);
      expect(await store.acquireLock('k1', 5)).toBe(false);
      expect(await store.acquireLock('k2', 5)).toBe(false);
    });
  });
});
