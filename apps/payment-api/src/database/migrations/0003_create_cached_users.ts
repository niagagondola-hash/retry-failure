import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 0003 - Create cached_users table (plan2 section 7.1).
 *
 * cached_users menyimpan info user stabil (dari auth `/api/v1/me/permissions`)
 * lintas sesi: user_id, username, email, name, is_super_admin, last_sync_at.
 *
 * PostgreSQL-native:
 *   - user_id uuid PK (default gen_random_uuid() — di app, biasanya diisi dari auth)
 *   - timestamp(3) untuk last_sync_at (ms precision)
 *
 * SQLite: TIDAK menjalankan migration ini (db-config.ts SQLITE_CONFIG pakai
 * synchronize=true — entity auto-create). Helper getUuidColumnType() &
 * getTimestampColumnType() dipakai di entity files (jika dibuat di AUTH-12/17).
 *
 * Index:
 *   - idx_cached_users_username (UNIQUE — username stabil dari auth)
 */
export class CreateCachedUsers0003170000000002 implements MigrationInterface {
  name = 'CreateCachedUsers0003170000000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "cached_users" (
        "user_id"          uuid            NOT NULL DEFAULT gen_random_uuid(),
        "username"         varchar(64)     NOT NULL,
        "email"            varchar(128),
        "name"             varchar(128)    NOT NULL,
        "is_super_admin"   boolean         NOT NULL DEFAULT false,
        "last_sync_at"     timestamp(3)   NOT NULL DEFAULT now(),
        CONSTRAINT "pk_cached_users" PRIMARY KEY ("user_id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_cached_users_username"
        ON "cached_users" ("username")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_cached_users_username"`);
    await queryRunner.query(`DROP TABLE "public"."cached_users"`);
  }
}
