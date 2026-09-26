/**
 * CacheRepository unit tests (AUTH-12).
 *
 * Plan reference: AUTH-12 task spec §3, PLAN2 §7.1 (cached_users table).
 *
 * Tests CacheRepository with mocked TypeORM Repository — verifies find/upsert/delete.
 */
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CacheRepository } from '../src/cache/cache.repository';
import { CachedUser } from '../src/cache/cached-user.entity';

/** Mock TypeORM Repository — in-memory Map mimicking DB. */
function mockRepository(): jest.Mocked<Repository<CachedUser>> & {
  store: Map<string, CachedUser>;
} {
  const store = new Map<string, CachedUser>();
  const repo = {
    store,
    findOne: jest.fn(async ({ where }: { where: { user_id: string } }) => {
      return store.get(where.user_id) ?? null;
    }),
    create: jest.fn((entity: Partial<CachedUser>) => entity as CachedUser),
    save: jest.fn(async (entity: CachedUser) => {
      store.set(entity.user_id, entity);
      return entity;
    }),
    delete: jest.fn(async (criteria: { user_id?: string }) => {
      if (criteria.user_id) {
        store.delete(criteria.user_id);
      }
      return { affected: 1, raw: {} };
    }),
  } as unknown as jest.Mocked<Repository<CachedUser>> & {
    store: Map<string, CachedUser>;
  };
  return repo;
}

describe('CacheRepository', () => {
  let repo: CacheRepository;
  let mockRepo: ReturnType<typeof mockRepository>;

  beforeEach(async () => {
    mockRepo = mockRepository();
    const mod = await Test.createTestingModule({
      providers: [
        CacheRepository,
        {
          provide: getRepositoryToken(CachedUser),
          useValue: mockRepo,
        },
      ],
    }).compile();
    repo = mod.get(CacheRepository);
  });

  describe('findCachedUser', () => {
    it('returns user when found', async () => {
      const user: CachedUser = {
        user_id: 'user-uuid-1',
        username: 'budi_santoso',
        email: 'budi@example.com',
        name: 'Budi',
        is_super_admin: false,
        last_sync_at: new Date(),
      };
      mockRepo.store.set('user-uuid-1', user);

      const result = await repo.findCachedUser('user-uuid-1');
      expect(result).toEqual(user);
      expect(mockRepo.findOne).toHaveBeenCalledWith({
        where: { user_id: 'user-uuid-1' },
      });
    });

    it('returns null when user not found', async () => {
      const result = await repo.findCachedUser('unknown-user');
      expect(result).toBeNull();
    });
  });

  describe('upsertCachedUser', () => {
    const input = {
      user_id: 'user-uuid-2',
      username: 'superadmin',
      email: 'admin@example.com',
      name: 'Super Admin',
      is_super_admin: true,
    };

    it('inserts new user when not exists', async () => {
      const result = await repo.upsertCachedUser(input);
      expect(result.user_id).toBe(input.user_id);
      expect(result.username).toBe(input.username);
      expect(result.is_super_admin).toBe(true);
      expect(result.last_sync_at).toBeInstanceOf(Date);
      expect(mockRepo.store.has(input.user_id)).toBe(true);
      expect(mockRepo.create).toHaveBeenCalled();
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('updates existing user when exists', async () => {
      // Seed existing user
      const existing: CachedUser = {
        user_id: 'user-uuid-2',
        username: 'old_username',
        email: 'old@example.com',
        name: 'Old Name',
        is_super_admin: false,
        last_sync_at: new Date('2020-01-01'),
      };
      mockRepo.store.set('user-uuid-2', existing);

      const result = await repo.upsertCachedUser(input);
      expect(result.username).toBe('superadmin');
      expect(result.name).toBe('Super Admin');
      expect(result.is_super_admin).toBe(true);
      expect(result.email).toBe('admin@example.com');
      // last_sync_at should be updated to now
      expect(result.last_sync_at.getTime()).toBeGreaterThan(
        new Date('2020-01-01').getTime(),
      );
      expect(mockRepo.save).toHaveBeenCalled();
    });

    it('handles null email', async () => {
      const result = await repo.upsertCachedUser({
        ...input,
        email: null,
      });
      expect(result.email).toBeNull();
    });

    it('handles undefined email (defaults to null)', async () => {
      const { email: _ignored, ...inputWithoutEmail } = input;
      const result = await repo.upsertCachedUser(inputWithoutEmail);
      expect(result.email).toBeNull();
    });
  });

  describe('deleteCachedUser', () => {
    it('deletes user by user_id', async () => {
      const user: CachedUser = {
        user_id: 'user-to-delete',
        username: 'delete-me',
        email: null,
        name: 'Delete Me',
        is_super_admin: false,
        last_sync_at: new Date(),
      };
      mockRepo.store.set('user-to-delete', user);

      await repo.deleteCachedUser('user-to-delete');
      expect(mockRepo.store.has('user-to-delete')).toBe(false);
      expect(mockRepo.delete).toHaveBeenCalledWith({
        user_id: 'user-to-delete',
      });
    });

    it('does not throw when user does not exist', async () => {
      await expect(repo.deleteCachedUser('unknown')).resolves.not.toThrow();
    });
  });
});
