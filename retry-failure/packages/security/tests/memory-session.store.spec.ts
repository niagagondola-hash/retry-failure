import { MemorySessionStore } from '../src/session-store/memory-session.store';
import type { Session } from '../src/session-store/session-store.interface';

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
    accessExpiresAt: now + 15 * 60 * 1000, // 15m
    refreshExpiresAt: now + 8 * 60 * 60 * 1000, // 8h
    createdAt: now,
    lastSeenAt: now,
    lastSyncAt: now,
    ...overrides,
  };
}

describe('MemorySessionStore', () => {
  let store: MemorySessionStore;

  beforeEach(() => {
    store = new MemorySessionStore({
      max: 100,
      defaultTtlMs: 60 * 1000,
      lockCleanupMs: 60 * 1000,
    });
  });

  afterEach(() => {
    store.onModuleDestroy();
  });

  it('get returns null for missing sid', async () => {
    expect(await store.get('nope')).toBeNull();
  });

  it('set + get roundtrip', async () => {
    const s = makeSession({ sid: 'sid-1' });
    await store.set('sid-1', s, 60_000);
    const got = await store.get('sid-1');
    expect(got).not.toBeNull();
    expect(got?.userId).toEqual('user-1');
  });

  it('delete removes the session', async () => {
    const s = makeSession({ sid: 'sid-2' });
    await store.set('sid-2', s, 60_000);
    expect(await store.get('sid-2')).not.toBeNull();
    await store.delete('sid-2');
    expect(await store.get('sid-2')).toBeNull();
  });

  it('delete on missing sid is a no-op (no throw)', async () => {
    await expect(store.delete('never-set')).resolves.toBeUndefined();
  });

  it('touch updates lastSeenAt + refreshes TTL', async () => {
    const s = makeSession({ sid: 'sid-3', lastSeenAt: 0 });
    await store.set('sid-3', s, 5_000);
    await new Promise((r) => setTimeout(r, 5));
    await store.touch('sid-3');
    const got = await store.get('sid-3');
    expect(got).not.toBeNull();
    expect(got?.lastSeenAt).toBeGreaterThan(0);
  });

  it('touch on missing sid is a no-op', async () => {
    await expect(store.touch('missing')).resolves.toBeUndefined();
  });

  it('touch on already-expired session deletes it (no set with negative ttl)', async () => {
    const s = makeSession({
      sid: 'sid-expired',
      refreshExpiresAt: Date.now() - 1000,
    });
    await store.set('sid-expired', s, 60_000);
    await store.touch('sid-expired');
    // After touch on expired session, the entry should be removed
    expect(await store.get('sid-expired')).toBeNull();
  });

  it('updateSync updates permissionCodes + lastSyncAt', async () => {
    const s = makeSession({ sid: 'sid-4', permissionCodes: [] });
    await store.set('sid-4', s, 60_000);
    const syncAt = Date.now();
    await store.updateSync('sid-4', ['payment.read', 'payment.write'], syncAt);
    const got = await store.get('sid-4');
    expect(got?.permissionCodes).toEqual(['payment.read', 'payment.write']);
    expect(got?.lastSyncAt).toEqual(syncAt);
  });

  it('listActive returns all non-expired sessions', async () => {
    await store.set('a', makeSession({ sid: 'a' }), 60_000);
    await store.set('b', makeSession({ sid: 'b' }), 60_000);
    const active = await store.listActive();
    expect(active).toHaveLength(2);
    const sids = active.map((s) => s.sid).sort();
    expect(sids).toEqual(['a', 'b']);
  });

  describe('acquireLock / releaseLock', () => {
    it('first acquire returns true', async () => {
      expect(await store.acquireLock('test', 5)).toBe(true);
    });

    it('second acquire on same key returns false (still held)', async () => {
      expect(await store.acquireLock('test', 5)).toBe(true);
      expect(await store.acquireLock('test', 5)).toBe(false);
    });

    it('acquire after release returns true', async () => {
      expect(await store.acquireLock('test', 5)).toBe(true);
      await store.releaseLock('test');
      expect(await store.acquireLock('test', 5)).toBe(true);
    });

    it('release on non-held lock is idempotent (no throw)', async () => {
      await expect(store.releaseLock('never')).resolves.toBeUndefined();
    });

    it('acquire after TTL expiry returns true again', async () => {
      // Acquire with very short TTL
      expect(await store.acquireLock('test', 0.05)).toBe(true); // 50ms TTL
      // Wait for TTL to expire
      await new Promise((r) => setTimeout(r, 100));
      expect(await store.acquireLock('test', 5)).toBe(true);
    });

    it('different keys are independent', async () => {
      expect(await store.acquireLock('k1', 5)).toBe(true);
      expect(await store.acquireLock('k2', 5)).toBe(true);
      expect(await store.acquireLock('k1', 5)).toBe(false);
      expect(await store.acquireLock('k2', 5)).toBe(false);
    });
  });

  it('onModuleDestroy clears everything', async () => {
    await store.set('x', makeSession({ sid: 'x' }), 60_000);
    await store.acquireLock('lock-x', 5);
    store.onModuleDestroy();
    expect(await store.get('x')).toBeNull();
    // After destroy, locks map is cleared — acquire should succeed again
    expect(await store.acquireLock('lock-x', 5)).toBe(true);
  });
});
