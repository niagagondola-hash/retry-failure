/**
 * CacheRepository — TypeORM Repository for `cached_users` table (AUTH-12).
 *
 * Plan reference: PLAN2 Section 7.1 (cached_users), Section 8 (lazy sync),
 * Section 9 (packages/security structure), AUTH-12 task spec §2.
 *
 * Provides CRUD + upsert for `CachedUser` entities. Used by:
 *   - `SessionGuard` (AUTH-13) — lookup `is_super_admin` for current user.
 *   - `AuthSyncService` (AUTH-14) — upsert user data after lazy sync.
 *
 * Uses TypeORM Repository pattern via `@InjectRepository(CachedUser)`.
 */
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { CachedUser } from './cached-user.entity';

/** Input shape for upsert — partial CachedUser without internal fields. */
export interface UpsertCachedUserInput {
  user_id: string;
  username: string;
  email?: string | null;
  name: string;
  is_super_admin: boolean;
}

@Injectable()
export class CacheRepository {
  constructor(
    @InjectRepository(CachedUser)
    private readonly userRepo: Repository<CachedUser>,
  ) {}

  /** Find cached user by user_id. Returns null if not cached. */
  async findCachedUser(userId: string): Promise<CachedUser | null> {
    return this.userRepo.findOne({ where: { user_id: userId } });
  }

  /**
   * Upsert cached user — PostgreSQL ON CONFLICT (user_id) DO UPDATE.
   * Updates `last_sync_at` to current timestamp on every upsert.
   *
   * @param data - User fields to upsert
   * @returns The persisted CachedUser entity
   */
  async upsertCachedUser(data: UpsertCachedUserInput): Promise<CachedUser> {
    const now = new Date();
    const existing = await this.userRepo.findOne({
      where: { user_id: data.user_id },
    });

    if (existing) {
      // Update in-place
      existing.username = data.username;
      existing.email = data.email ?? null;
      existing.name = data.name;
      existing.is_super_admin = data.is_super_admin;
      existing.last_sync_at = now;
      return this.userRepo.save(existing);
    }

    // Insert new
    const entity = this.userRepo.create({
      user_id: data.user_id,
      username: data.username,
      email: data.email ?? null,
      name: data.name,
      is_super_admin: data.is_super_admin,
      last_sync_at: now,
    });
    return this.userRepo.save(entity);
  }

  /** Delete cached user by user_id. Used when user is revoked at auth. */
  async deleteCachedUser(userId: string): Promise<void> {
    await this.userRepo.delete({ user_id: userId });
  }
}
