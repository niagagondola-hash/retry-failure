/**
 * SessionService unit tests (AUTH-12).
 *
 * Plan reference: AUTH-12 task spec §2, PLAN2 §5.3 (token TTL), §9.4 (session store).
 *
 * Tests SessionService with mocked SessionStore — verifies business logic
 * for create/get/delete/touch/updateSync/updateOnSwitchRole.
 */
import { Test } from '@nestjs/testing';

import { TokenSet } from '../src/oauth/oauth-client.types';
import { SessionService } from '../src/oauth/session.service';
import {
  SESSION_STORE,
  Session,
  SessionStore,
} from '../src/session-store';

/** Mock SessionStore — in-memory Map, satisfies interface contract. */
function mockSessionStore(): SessionStore & {
  sessions: Map<string, Session>;
} {
  const sessions = new Map<string, Session>();
  const store: SessionStore = {
    async get(sid) {
      return sessions.get(sid) ?? null;
    },
    async set(sid, session, _ttlMs) {
      sessions.set(sid, session);
    },
    async delete(sid) {
      sessions.delete(sid);
    },
    async touch(sid) {
      const s = sessions.get(sid);
      if (s) {
        s.lastSeenAt = Date.now();
      }
    },
    async updateSync(sid, permissionCodes, lastSyncAt) {
      const s = sessions.get(sid);
      if (s) {
        s.permissionCodes = permissionCodes;
        s.lastSyncAt = lastSyncAt;
      }
    },
    async listActive() {
      return Array.from(sessions.values());
    },
    async acquireLock(_key, _ttlSec) {
      return true;
    },
    async releaseLock(_key) {
      // no-op
    },
  };
  return Object.assign(store, { sessions });
}

describe('SessionService', () => {
  let svc: SessionService;
  let store: ReturnType<typeof mockSessionStore>;

  beforeEach(async () => {
    store = mockSessionStore();
    const mod = await Test.createTestingModule({
      providers: [
        SessionService,
        { provide: SESSION_STORE, useValue: store },
      ],
    }).compile();
    svc = mod.get(SessionService);
  });

  describe('create', () => {
    const input = {
      userId: '00000000-0000-1000-8000-000000000001',
      username: 'budi_santoso',
      roleId: '00000000-0000-1000-8000-000000000102',
      permissionCodes: ['dashboard', 'payment.read'],
      tokens: {
        accessToken: 'access.jwt.token',
        refreshToken: 'refresh.jwt.token',
        expiresAt: Math.floor(Date.now() / 1000) + 900, // 15 min from now
        tokenType: 'Bearer' as const,
      } satisfies TokenSet,
    };

    it('creates session with 64-char hex sid', async () => {
      const { sid, session } = await svc.create(input);
      expect(sid).toMatch(/^[0-9a-f]{64}$/);
      expect(session.sid).toBe(sid);
    });

    it('populates session fields from input', async () => {
      const { session } = await svc.create(input);
      expect(session.userId).toBe(input.userId);
      expect(session.username).toBe(input.username);
      expect(session.roleId).toBe(input.roleId);
      expect(session.permissionCodes).toEqual(input.permissionCodes);
      expect(session.accessToken).toBe(input.tokens.accessToken);
      expect(session.refreshToken).toBe(input.tokens.refreshToken);
    });

    it('converts expiresAt seconds → ms for accessExpiresAt', async () => {
      const { session } = await svc.create(input);
      expect(session.accessExpiresAt).toBe(input.tokens.expiresAt * 1000);
    });

    it('sets refreshExpiresAt to now + 8h', async () => {
      const before = Date.now();
      const { session } = await svc.create(input);
      const after = Date.now();
      // 8h in ms = 28800000
      expect(session.refreshExpiresAt - before).toBeGreaterThanOrEqual(28800000 - 1000);
      expect(session.refreshExpiresAt - after).toBeLessThanOrEqual(28800000 + 1000);
    });

    it('sets createdAt = lastSeenAt = lastSyncAt = now', async () => {
      const before = Date.now();
      const { session } = await svc.create(input);
      const after = Date.now();
      expect(session.createdAt).toBeGreaterThanOrEqual(before);
      expect(session.createdAt).toBeLessThanOrEqual(after);
      expect(session.lastSeenAt).toBe(session.createdAt);
      expect(session.lastSyncAt).toBe(session.createdAt);
    });

    it('persists session to store', async () => {
      const { sid, session } = await svc.create(input);
      expect(store.sessions.get(sid)).toEqual(session);
    });

    it('handles missing refreshToken (defaults to empty string)', async () => {
      const { session } = await svc.create({
        ...input,
        tokens: { ...input.tokens, refreshToken: undefined } as TokenSet,
      });
      expect(session.refreshToken).toBe('');
    });
  });

  describe('get', () => {
    it('returns session when sid exists', async () => {
      const { sid, session } = await svc.create({
        userId: 'user-1',
        username: 'u1',
        roleId: 'role-1',
        permissionCodes: [],
        tokens: {
          accessToken: 'a',
          refreshToken: 'r',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          tokenType: 'Bearer',
        },
      });
      const fetched = await svc.get(sid);
      expect(fetched).toEqual(session);
    });

    it('returns null for unknown sid', async () => {
      expect(await svc.get('unknown-sid')).toBeNull();
    });
  });

  describe('delete', () => {
    it('removes session from store', async () => {
      const { sid } = await svc.create({
        userId: 'user-1',
        username: 'u1',
        roleId: 'role-1',
        permissionCodes: [],
        tokens: {
          accessToken: 'a',
          refreshToken: 'r',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          tokenType: 'Bearer',
        },
      });
      await svc.delete(sid);
      expect(store.sessions.has(sid)).toBe(false);
    });
  });

  describe('touch', () => {
    it('delegates to store.touch', async () => {
      const { sid, session } = await svc.create({
        userId: 'user-1',
        username: 'u1',
        roleId: 'role-1',
        permissionCodes: [],
        tokens: {
          accessToken: 'a',
          refreshToken: 'r',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          tokenType: 'Bearer',
        },
      });
      const originalLastSeen = session.lastSeenAt;
      await new Promise((r) => setTimeout(r, 5));
      await svc.touch(sid);
      expect(store.sessions.get(sid)!.lastSeenAt).toBeGreaterThan(originalLastSeen);
    });
  });

  describe('updateSync', () => {
    it('updates permissionCodes + lastSyncAt', async () => {
      const { sid } = await svc.create({
        userId: 'user-1',
        username: 'u1',
        roleId: 'role-1',
        permissionCodes: ['dashboard'],
        tokens: {
          accessToken: 'a',
          refreshToken: 'r',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          tokenType: 'Bearer',
        },
      });
      const before = Date.now();
      await svc.updateSync(sid, ['dashboard', 'payment.read', 'payment.write']);
      const session = store.sessions.get(sid)!;
      expect(session.permissionCodes).toEqual([
        'dashboard',
        'payment.read',
        'payment.write',
      ]);
      expect(session.lastSyncAt).toBeGreaterThanOrEqual(before);
    });
  });

  describe('updateOnSwitchRole', () => {
    it('updates roleId + tokens + permissionCodes + lastSyncAt', async () => {
      const { sid } = await svc.create({
        userId: 'user-1',
        username: 'u1',
        roleId: 'role-old',
        permissionCodes: ['dashboard'],
        tokens: {
          accessToken: 'old-access',
          refreshToken: 'old-refresh',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          tokenType: 'Bearer',
        },
      });

      const newTokens: TokenSet = {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        tokenType: 'Bearer',
      };
      const updated = await svc.updateOnSwitchRole(
        sid,
        'role-new',
        newTokens,
        ['dashboard', 'payment.read', 'payment.write', 'payment.retry'],
      );
      expect(updated).not.toBeNull();
      expect(updated!.roleId).toBe('role-new');
      expect(updated!.accessToken).toBe('new-access');
      expect(updated!.refreshToken).toBe('new-refresh');
      expect(updated!.permissionCodes).toHaveLength(4);
    });

    it('returns null when session no longer exists', async () => {
      const result = await svc.updateOnSwitchRole(
        'unknown-sid',
        'role-new',
        {
          accessToken: 'a',
          refreshToken: 'r',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          tokenType: 'Bearer',
        },
        [],
      );
      expect(result).toBeNull();
    });

    it('keeps old refreshToken when new one is undefined', async () => {
      const { sid } = await svc.create({
        userId: 'user-1',
        username: 'u1',
        roleId: 'role-old',
        permissionCodes: [],
        tokens: {
          accessToken: 'old-access',
          refreshToken: 'old-refresh',
          expiresAt: Math.floor(Date.now() / 1000) + 900,
          tokenType: 'Bearer',
        },
      });
      const updated = await svc.updateOnSwitchRole(sid, 'role-new', {
        accessToken: 'new-access',
        // refreshToken undefined — should keep old
        expiresAt: Math.floor(Date.now() / 1000) + 900,
        tokenType: 'Bearer',
      } as TokenSet, []);
      expect(updated!.refreshToken).toBe('old-refresh');
    });
  });
});
