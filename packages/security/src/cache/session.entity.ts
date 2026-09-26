/**
 * SessionEntity — TypeORM entity for `sessions` table (AUTH-12, AUTH-16).
 *
 * Plan reference: PLAN2 Section 7.2 (sessions table), Section 8 (lazy sync).
 *
 * Migration: `apps/payment-api/src/database/migrations/0004_create_sessions.ts`.
 *
 * `sessions` table stores session snapshots for audit/PostgreSQL session store.
 * In Redis/memory store mode, this table is optional (only for audit trail).
 *
 * Note: This entity lives in `packages/security` (shared library). Conditional
 * registration in `payment-api` — only if `SESSION_STORE != memory` or
 * `SESSION_AUDIT_ENABLED=true`.
 */
import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** Table name — matches migration `0004_create_sessions.ts`. */
export const SESSION_TABLE = 'sessions';

/**
 * `permission_codes` stored as JSONB (PostgreSQL) or JSON (SQLite).
 * TypeORM maps `simple-json` for SQLite; PostgreSQL uses `jsonb`.
 */
export type PermissionCodes = string[];

@Entity({ name: SESSION_TABLE })
@Index('idx_sessions_user_id', ['user_id'])
@Index('idx_sessions_last_sync_at', ['last_sync_at'])
@Index('idx_sessions_refresh_expires_at', ['refresh_expires_at'])
export class SessionEntity {
  /** Session ID — opaque random string (also stored in cookie `sid`). */
  @PrimaryColumn('varchar', { name: 'sid', length: 64 })
  sid!: string;

  /** User UUID — FK to `cached_users.user_id` (cascade delete). */
  @Column('uuid', { name: 'user_id' })
  user_id!: string;

  /** Active role UUID from JWT. */
  @Column('uuid', { name: 'role_id' })
  role_id!: string;

  /** Permission codes snapshot (JSON array). */
  @Column('simple-json', { name: 'permission_codes' })
  permission_codes: PermissionCodes = [];

  /** OAuth2 access token (JWT RS256). Encrypted at rest in production. */
  @Column('text', { name: 'access_token', nullable: true })
  access_token: string | null = null;

  /** OAuth2 refresh token (rotated on each refresh). Encrypted at rest. */
  @Column('text', { name: 'refresh_token', nullable: true })
  refresh_token: string | null = null;

  /** Access token expiry — Unix ms epoch. */
  @Column('timestamp', { name: 'access_expires_at', nullable: true, precision: 3 })
  access_expires_at: Date | null = null;

  /** Refresh token expiry — Unix ms epoch (session TTL reference). */
  @Column('timestamp', { name: 'refresh_expires_at', nullable: true, precision: 3 })
  refresh_expires_at: Date | null = null;

  /** Session creation — Unix ms epoch. */
  @Column('timestamp', { name: 'created_at', precision: 3 })
  created_at!: Date;

  /** Last request seen — Unix ms epoch (rolling session TTL reference). */
  @Column('timestamp', { name: 'last_seen_at', precision: 3 })
  last_seen_at!: Date;

  /** Last permission sync — Unix ms epoch (lazy-sync source-of-truth check). */
  @Column('timestamp', { name: 'last_sync_at', precision: 3 })
  last_sync_at!: Date;
}
