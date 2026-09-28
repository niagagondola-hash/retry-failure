/**
 * CachedUser — TypeORM entity for `cached_users` table (AUTH-12, AUTH-16).
 *
 * Cross-database types via getTimestampColumnType() + getUuidColumnType():
 *   - PostgreSQL: 'uuid' + 'timestamp' (native)
 *   - SQLite: 'varchar' + 'datetime' (compatibility)
 *
 * Timing: loadEnv() in otel.ts runs BEFORE entity decorators evaluate,
 * so process.env.DB_TYPE is set when getTimestampColumnType() is called.
 */
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import { getUuidColumnType, getTimestampColumnType } from './db-types.helper';

export const CACHED_USER_TABLE = 'cached_users';

@Entity({ name: CACHED_USER_TABLE })
@Index('idx_cached_users_username', ['username'], { unique: true })
export class CachedUser {
  @PrimaryColumn({ type: getUuidColumnType(), name: 'user_id' })
  user_id!: string;

  @Column('varchar', { name: 'username', length: 64 })
  username!: string;

  @Column('varchar', { name: 'email', length: 128, nullable: true })
  email: string | null = null;

  @Column('varchar', { name: 'name', length: 128 })
  name!: string;

  @Column('boolean', { name: 'is_super_admin', default: false })
  is_super_admin: boolean = false;

  @Column({ type: getTimestampColumnType(), name: 'last_sync_at', default: () => 'CURRENT_TIMESTAMP' })
  last_sync_at!: Date;
}
