import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 0005 - Add user_id (nullable) to payments (plan2 section 7.3).
 *
 * Add column `user_id uuid` ke tabel `payments` (sudah dibuat di migration 0001):
 *   - NULLABLE (per user decision) — existing payments dari Plan1 tidak punya
 *     user_id, supaya tidak rusak saat migration run.
 *   - FK → cached_users.user_id ON DELETE SET NULL (audit trail tetap ada
 *     bila user di-delete dari cache — payment history tetap preserved).
 *   - Index idx_payments_user_id (untuk query "payments by user").
 *
 * PostgreSQL-native: uuid type. SQLite: varchar(36) via entity helper
 * (db-config.ts SQLITE_CONFIG pakai synchronize=true — tidak menjalankan
 * migration ini, entity auto-create).
 *
 * NOTE: Tidak ada down-migration terpisah (0006) — file ini sekaligus punya
 * `down()` method yang revert column + FK + index. Mengikuti pola 0001 + 0002
 * (satu file migration = satu pasangan up/down).
 */
export class AddPaymentsUserId0005170000000004 implements MigrationInterface {
  name = 'AddPaymentsUserId0005170000000004';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // NULLABLE: existing payments dari Plan1 tidak punya user_id — supaya
    // tidak break saat migration run. Aplikasi set user_id saat user login +
    // create payment. Bila user di-delete, user_id jadi NULL (audit trail).
    await queryRunner.query(`ALTER TABLE "payments" ADD COLUMN "user_id" uuid`);

    await queryRunner.query(`
      ALTER TABLE "payments"
        ADD CONSTRAINT "fk_payments_user_id"
        FOREIGN KEY ("user_id")
        REFERENCES "cached_users" ("user_id")
        ON DELETE SET NULL
    `);

    await queryRunner.query(`CREATE INDEX "idx_payments_user_id" ON "payments" ("user_id")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_payments_user_id"`);
    await queryRunner.query(`ALTER TABLE "public"."payments" DROP CONSTRAINT "fk_payments_user_id"`);
    await queryRunner.query(`ALTER TABLE "public"."payments" DROP COLUMN "user_id"`);
  }
}
