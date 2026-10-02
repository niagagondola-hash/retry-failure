/**
 * Migration: Add id_token column to sessions table (AUTH-09a).
 *
 * Plan reference: AUTH-09a task spec — RP-initiated logout butuh `id_token_hint`
 * parameter = id_token yang diterima saat login. Session object sekarang simpan
 * `idToken` field, yang perlu DB column `id_token`.
 *
 * SQLite (sandbox): synchronize=true → auto-create column, skip migration.
 * PostgreSQL (lokal/production): synchronize=false → WAJIB run `pnpm db:migrate`.
 */
import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddIdTokenToSessions1700000000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sessions" ADD COLUMN "id_token" TEXT`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sessions" DROP COLUMN "id_token"`,
    );
  }
}
