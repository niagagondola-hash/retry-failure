/**
 * AuthSyncService unit tests (AUTH-14).
 *
 * Plan reference: PLAN2 Section 8.1 (lazy sync trigger), Section 8.2 (alur),
 * Section 7.1 (cached_users), AUTH-14 task spec §3 + §7.
 *
 * Verifies:
 *   - `syncSession` calls `OAuthClientService.fetchPermissions(accessToken)`
 *   - then `CacheRepository.upsertCachedUser({ user_id, username, email, name, is_super_admin })`
 *   - then `SessionStore.updateSync(sid, permissionCodes, Date.now())`
 *   - returns `{ permissionCodes, user }` on success
 *   - propagates error from `fetchPermissions` (auth down) — session NOT updated
 *   - propagates error from `upsertCachedUser` — session NOT updated
 */
import { Test } from '@nestjs/testing';

import { CacheRepository } from '../src/cache/cache.repository';
import { OAuthClientService } from '../src/oauth/oauth-client.service';
import type { PermissionsResponse } from '../src/oauth/oauth-client.types';
import {
  SESSION_STORE,
  Session,
  SessionStore,
} from '../src/session-store';
import { AuthSyncService } from '../src/sync/auth-sync.service';

/** Build a mock session record. */
function mockSession(overrides: Partial<Session> = {}): Session {
  return {
    sid: 'a'.repeat(64),
    userId: 'user-uuid-1',
    username: 'budi_santoso',
    roleId: 'role-uuid-102',
    permissionCodes: ['dashboard'],
    accessToken: 'access.jwt.token',
    idToken: 'id-token.jwt',
    refreshToken: 'refresh.jwt.token',
    accessExpiresAt: Date.now() + 900_000,
    refreshExpiresAt: Date.now() + 8 * 60 * 60 * 1000,
    createdAt: Date.now(),
    lastSeenAt: Date.now(),
    lastSyncAt: Date.now(),
    ...overrides,
  };
}

/** Build a mock PermissionsResponse. */
function mockPermissionsResponse(): PermissionsResponse {
  return {
    user: {
      id: 'user-uuid-1',
      username: 'budi_santoso',
      email: 'budi@example.com',
      name: 'Budi Santoso',
      isSuperAdmin: false,
    },
    role: { id: 'role-uuid-102', name: 'Finance' },
    permissionCodes: ['dashboard', 'payment.read', 'payment.write'],
  };
}

/** Build a fully-mocked SessionStore — only `updateSync` matters here. */
function mockSessionStore(): jest.Mocked<SessionStore> {
  return {
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
    get: jest.fn(),
    set: jest.fn(),
    delete: jest.fn(),
    touch: jest.fn(),
    updateSync: jest.fn().mockResolvedValue(undefined),
    listActive: jest.fn(),
  } as unknown as jest.Mocked<SessionStore>;
}

describe('AuthSyncService', () => {
  let svc: AuthSyncService;
  let oauthClient: { fetchPermissions: jest.Mock };
  let cache: { upsertCachedUser: jest.Mock };
  let sessionStore: jest.Mocked<SessionStore>;

  beforeEach(async () => {
    oauthClient = {
      fetchPermissions: jest.fn().mockResolvedValue(mockPermissionsResponse()),
    };
    cache = {
      upsertCachedUser: jest.fn().mockResolvedValue(undefined),
    };
    sessionStore = mockSessionStore();

    const mod = await Test.createTestingModule({
      providers: [
        AuthSyncService,
        { provide: OAuthClientService, useValue: oauthClient },
        { provide: CacheRepository, useValue: cache },
        { provide: SESSION_STORE, useValue: sessionStore },
      ],
    }).compile();
    svc = mod.get(AuthSyncService);
  });

  describe('syncSession', () => {
    it('calls fetchPermissions with session.accessToken', async () => {
      const session = mockSession();
      await svc.syncSession(session);
      expect(oauthClient.fetchPermissions).toHaveBeenCalledWith(
        session.accessToken,
      );
    });

    it('upserts cached_user with mapped fields (user_id, username, email, name, is_super_admin)', async () => {
      const session = mockSession();
      const perms = mockPermissionsResponse();
      oauthClient.fetchPermissions.mockResolvedValue(perms);

      await svc.syncSession(session);

      expect(cache.upsertCachedUser).toHaveBeenCalledWith({
        user_id: perms.user.id,
        username: perms.user.username,
        email: perms.user.email,
        name: perms.user.name,
        is_super_admin: perms.user.isSuperAdmin,
      });
    });

    it('updates session via SessionStore.updateSync with sid + permissionCodes + Date.now()', async () => {
      const session = mockSession({ sid: 'mysid'.repeat(10).slice(0, 64) });
      const perms = mockPermissionsResponse();
      oauthClient.fetchPermissions.mockResolvedValue(perms);
      const before = Date.now();

      await svc.syncSession(session);

      const after = Date.now();
      expect(sessionStore.updateSync).toHaveBeenCalledWith(
        session.sid,
        perms.permissionCodes,
        expect.any(Number),
      );
      const callArg = sessionStore.updateSync.mock.calls[0][2];
      expect(callArg).toBeGreaterThanOrEqual(before);
      expect(callArg).toBeLessThanOrEqual(after);
    });

    it('returns { permissionCodes, user } on success', async () => {
      const session = mockSession();
      const perms = mockPermissionsResponse();
      oauthClient.fetchPermissions.mockResolvedValue(perms);

      const result = await svc.syncSession(session);

      expect(result).toEqual({
        permissionCodes: perms.permissionCodes,
        user: perms.user,
      });
    });

    it('propagates error from fetchPermissions and does NOT update cache or session', async () => {
      const session = mockSession();
      oauthClient.fetchPermissions.mockRejectedValue(new Error('auth down'));

      await expect(svc.syncSession(session)).rejects.toThrow('auth down');

      expect(cache.upsertCachedUser).not.toHaveBeenCalled();
      expect(sessionStore.updateSync).not.toHaveBeenCalled();
    });

    it('propagates error from upsertCachedUser and does NOT update session', async () => {
      const session = mockSession();
      cache.upsertCachedUser.mockRejectedValue(new Error('db write failed'));

      await expect(svc.syncSession(session)).rejects.toThrow('db write failed');

      expect(sessionStore.updateSync).not.toHaveBeenCalled();
    });

    it('propagates error from updateSync (caller catches + uses stale cache)', async () => {
      const session = mockSession();
      sessionStore.updateSync.mockRejectedValue(new Error('redis down'));

      await expect(svc.syncSession(session)).rejects.toThrow('redis down');

      // cache.upsertCachedUser ran, but session was not updated — caller (middleware) handles fallback
      expect(cache.upsertCachedUser).toHaveBeenCalledTimes(1);
    });
  });
});
