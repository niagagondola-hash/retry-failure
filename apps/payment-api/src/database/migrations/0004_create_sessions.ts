import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 0004 - Create sessions table (plan2 section 7.2).
 *
 * sessions menyimpan snapshot sesi + permissionCodes (audit trail, dipakai jika
 * `SESSION_STORE=postgres`). Untuk `SESSION_STORE=memory` / `redis`, tabel ini
 * tetap dibuat untuk audit (sync dari store ke DB, lazy).
 *
 * PostgreSQL-native:
 *   - user_id uuid FK → cached_users.user_id ON DELETE CASCADE
 *     (security: bila user di-delete, semua sesinya hilang — tidak bisa pakai
 *     sesi lama).
 *   - role_id uuid (dari JWT).
 *   - permission_codes jsonb (default '[]') — untuk query
 *     `WHERE permission_codes @> '["payment.write"]'::jsonb`.
 *   - access_token + refresh_token text (encrypted at rest — di app layer).
 *   - access_expires_at + refresh_expires_at timestamp(3) (ms precision).
 *   - created_at + last_seen_at + last_sync_at timestamp(3).
 *
 * Index:
 *   - idx_sessions_user_id (B-tree — query sessions by user, untuk logout-all)
 *   - idx_sessions_last_sync_at (B-tree — cleanup scheduler untuk session stale)
 *   - idx_sessions_refresh_expires_at (B-tree — cleanup session expired refresh)
 *   - idx_sessions_permission_codes_gin (GIN — query `@>` jsonb containment)
 *
 * SQLite: TIDAK menjalankan migration ini (db-config.ts SQLITE_CONFIG pakai
 * synchronize=true). Helper getUuidColumnType() dipakai di entity files.
 */
export class CreateSessions0004170000000003 implements MigrationInterface {
  name = 'CreateSessions0004170000000003';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "sessions" (
        "sid"                  varchar(64)     NOT NULL,
        "user_id"              uuid            NOT NULL,
        "role_id"              uuid            NOT NULL,
        "permission_codes"     jsonb           NOT NULL DEFAULT '[]',
        "access_token"         text,
        "refresh_token"        text,
        "access_expires_at"    timestamp(3),
        "refresh_expires_at"   timestamp(3),
        "created_at"           timestamp(3)   NOT NULL DEFAULT now(),
        "last_seen_at"         timestamp(3)   NOT NULL DEFAULT now(),
        "last_sync_at"         timestamp(3)   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_sessions" PRIMARY KEY ("sid"),
        CONSTRAINT "fk_sessions_cached_users"
          FOREIGN KEY ("user_id")
          REFERENCES "cached_users" ("user_id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_sessions_user_id" ON "sessions" ("user_id")`);
    await queryRunner.query(`CREATE INDEX "idx_sessions_last_sync_at" ON "sessions" ("last_sync_at")`);
    await queryRunner.query(`CREATE INDEX "idx_sessions_refresh_expires_at" ON "sessions" ("refresh_expires_at")`);

    // GIN index untuk query `permission_codes @> '["payment.write"]'::jsonb`
    // (plan2 section 7.5 — query "siapa yang punya permission X" atau
    // "session yang masih punya akses menu Y").
    await queryRunner.query(`CREATE INDEX "idx_sessions_permission_codes_gin" ON "sessions" USING GIN ("permission_codes")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_sessions_permission_codes_gin"`);
    await queryRunner.query(`DROP INDEX "public"."idx_sessions_refresh_expires_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_sessions_last_sync_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_sessions_user_id"`);
    await queryRunner.query(`DROP TABLE "public"."sessions"`);
  }
}
