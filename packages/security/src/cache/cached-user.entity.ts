/**
 * CachedUser — TypeORM entity for `cached_users` table (AUTH-12, AUTH-16).
 *
 * Plan reference: PLAN2 Section 7.1 (cached_users table), Section 6.3 (is_super_admin source).
 *
 * Migration: `apps/payment-api/src/database/migrations/0003_create_cached_users.ts`.
 *
 * `cached_users` stores stable user info across sessions. Updated by lazy sync
 * (AUTH-14) on first login + periodically when session permission data is stale.
 *
 * Note: This entity lives in `packages/security` (shared library) so both
 * `payment-api` and `auth-mock` can import it. The migration runs in
 * `payment-api` DB only.
 */
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Table name — matches migration `0003_create_cached_users.ts`. */
export const CACHED_USER_TABLE = 'cached_users';

@Entity({ name: CACHED_USER_TABLE })
@Index('idx_cached_users_username', ['username'], { unique: true })
export class CachedUser {
  /** User UUID from auth (JWT `sub`). Primary key. */
  @PrimaryColumn('uuid', { name: 'user_id' })
  user_id!: string;

  /** Unique username (e.g. "budi_santoso"). */
  @Column('varchar', { name: 'username', length: 64 })
  username!: string;

  /** Optional email. */
  @Column('varchar', { name: 'email', length: 128, nullable: true })
  email: string | null = null;

  /** Display name. */
  @Column('varchar', { name: 'name', length: 128 })
  name!: string;

  /** Super admin bypass flag — stable across sessions (plan2 §6.3). */
  @Column('boolean', { name: 'is_super_admin', default: false })
  is_super_admin: boolean = false;

  /** Last lazy-sync timestamp (Unix ms epoch). */
  @Column('timestamp', {
    name: 'last_sync_at',
    precision: 3,
    default: () => 'CURRENT_TIMESTAMP(3)',
  })
  last_sync_at!: Date;
}
