/**
 * PostgresSessionStore unit tests (AUTH-11a mode 2).
 *
 * Tests with mocked TypeORM Repository — verifies CRUD + lock operations.
 */
import { Repository } from 'typeorm';

import { SessionEntity } from '../src/cache/session.entity';
import { PostgresSessionStore } from '../src/session-store/postgres.store';
import { Session } from '../src/session-store/session-store.interface';

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

function mockEntity(overrides: Partial<SessionEntity> = {}): SessionEntity {
  return {
    sid: 'test-sid-123',
    user_id: 'user-uuid-1',
    role_id: 'role-uuid-102',
    permission_codes: ['dashboard', 'payment.read'],
    access_token: 'access.jwt',
    id_token: 'id-token.jwt',
    refresh_token: 'refresh.jwt',
    access_expires_at: new Date(Date.now() + 900_000),
    refresh_expires_at: new Date(Date.now() + 8 * 60 * 60 * 1000),
    created_at: new Date(),
    last_seen_at: new Date(),
    last_sync_at: new Date(),
    ...overrides,
  };
}

describe('PostgresSessionStore', () => {
  let store: PostgresSessionStore;
  let repo: jest.Mocked<Repository<SessionEntity>>;

  beforeEach(async () => {
    repo = {
      findOne: jest.fn(),
      create: jest.fn((e) => e as SessionEntity),
      save: jest.fn(async (e) => e as SessionEntity),
      delete: jest.fn(async () => ({ affected: 1, raw: {} })),
      update: jest.fn(async () => ({ affected: 1, raw: {} })),
      createQueryBuilder: jest.fn(() => ({
        where: jest.fn().mockReturnThis(),
        getMany: jest.fn(async () => []),
      })),
    } as unknown as jest.Mocked<Repository<SessionEntity>>;

    store = new PostgresSessionStore(repo);
  });

  describe('get', () => {
    it('returns session when found', async () => {
      repo.findOne.mockResolvedValue(mockEntity());
      const result = await store.get('test-sid-123');
      expect(result).not.toBeNull();
      expect(result!.sid).toBe('test-sid-123');
      expect(result!.userId).toBe('user-uuid-1');
    });

    it('returns null when not found', async () => {
      repo.findOne.mockResolvedValue(null);
      const result = await store.get('unknown-sid');
      expect(result).toBeNull();
    });

    it('deletes + returns null when expired', async () => {
      const expired = mockEntity({
        refresh_expires_at: new Date(Date.now() - 1000),
      });
      repo.findOne.mockResolvedValue(expired);
      const result = await store.get('expired-sid');
      expect(result).toBeNull();
      expect(repo.delete).toHaveBeenCalledWith({ sid: 'expired-sid' });
    });
  });

  describe('set', () => {
    it('inserts new session when not exists', async () => {
      repo.findOne.mockResolvedValue(null);
      await store.set('new-sid', mockSession(), 3600_000);
      expect(repo.create).toHaveBeenCalled();
      expect(repo.save).toHaveBeenCalled();
    });

    it('updates existing session when found', async () => {
      repo.findOne.mockResolvedValue(mockEntity());
      await store.set('test-sid', mockSession({ roleId: 'new-role' }), 3600_000);
      expect(repo.save).toHaveBeenCalled();
      const saved = (repo.save as jest.Mock).mock.calls[0][0];
      expect(saved.role_id).toBe('new-role');
    });
  });

  describe('delete', () => {
    it('deletes session by sid', async () => {
      await store.delete('test-sid');
      expect(repo.delete).toHaveBeenCalledWith({ sid: 'test-sid' });
    });
  });

  describe('touch', () => {
    it('updates last_seen_at', async () => {
      await store.touch('test-sid');
      expect(repo.update).toHaveBeenCalledWith(
        { sid: 'test-sid' },
        expect.objectContaining({ last_seen_at: expect.any(Date) }),
      );
    });
  });

  describe('updateSync', () => {
    it('updates permission_codes + last_sync_at', async () => {
      await store.updateSync('test-sid', ['dashboard'], Date.now());
      expect(repo.update).toHaveBeenCalledWith(
        { sid: 'test-sid' },
        expect.objectContaining({
          permission_codes: ['dashboard'],
          last_sync_at: expect.any(Date),
        }),
      );
    });
  });

  describe('acquireLock', () => {
    it('returns true on first acquire', async () => {
      const result = await store.acquireLock('lock-key', 10);
      expect(result).toBe(true);
    });

    it('returns false when lock already held', async () => {
      await store.acquireLock('lock-key', 10);
      const result = await store.acquireLock('lock-key', 10);
      expect(result).toBe(false);
    });
  });

  describe('releaseLock', () => {
    it('releases lock', async () => {
      await store.acquireLock('lock-key', 10);
      await store.releaseLock('lock-key');
      const result = await store.acquireLock('lock-key', 10);
      expect(result).toBe(true);
    });
  });
});
