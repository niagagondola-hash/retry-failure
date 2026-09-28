/**
 * SessionEntity — TypeORM entity for `sessions` table (AUTH-12, AUTH-16).
 *
 * Cross-database types via getTimestampColumnType() + getUuidColumnType():
 *   - PostgreSQL: 'uuid' + 'timestamp' (native)
 *   - SQLite: 'varchar' + 'datetime' (compatibility)
 */
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

import { getUuidColumnType, getTimestampColumnType } from './db-types.helper';

export const SESSION_TABLE = 'sessions';

export type PermissionCodes = string[];

@Entity({ name: SESSION_TABLE })
@Index('idx_sessions_user_id', ['user_id'])
@Index('idx_sessions_last_sync_at', ['last_sync_at'])
@Index('idx_sessions_refresh_expires_at', ['refresh_expires_at'])
export class SessionEntity {
  @PrimaryColumn('varchar', { name: 'sid', length: 64 })
  sid!: string;

  @Column({ type: getUuidColumnType(), name: 'user_id' })
  user_id!: string;

  @Column({ type: getUuidColumnType(), name: 'role_id' })
  role_id!: string;

  @Column('simple-json', { name: 'permission_codes' })
  permission_codes: PermissionCodes = [];

  @Column('text', { name: 'access_token', nullable: true })
  access_token: string | null = null;

  @Column('text', { name: 'refresh_token', nullable: true })
  refresh_token: string | null = null;

  @Column({ type: getTimestampColumnType(), name: 'access_expires_at', nullable: true })
  access_expires_at: Date | null = null;

  @Column({ type: getTimestampColumnType(), name: 'refresh_expires_at', nullable: true })
  refresh_expires_at: Date | null = null;

  @Column({ type: getTimestampColumnType(), name: 'created_at' })
  created_at!: Date;

  @Column({ type: getTimestampColumnType(), name: 'last_seen_at' })
  last_seen_at!: Date;

  @Column({ type: getTimestampColumnType(), name: 'last_sync_at' })
  last_sync_at!: Date;
}
