import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Initial migration — create native PG enums + tables + indexes (plan section 11 rev 2).
 *
 * Tables:
 *   - payments (plan 11.1)
 *   - payment_attempts (plan 11.2)
 *
 * Native PG types:
 *   - uuid PK (gen_random_uuid)
 *   - numeric(12,2)
 *   - timestamp(3) (ms precision)
 *   - native enum payment_status_enum, attempt_outcome_enum
 */
export class Init0001170000000000 implements MigrationInterface {
  name = 'Init0001170000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Create native PG enum types
    await queryRunner.query(`
      CREATE TYPE "public"."payment_status_enum" AS ENUM(
        'processing',
        'succeeded',
        'failed',
        'scheduled_for_retry'
      )
    `);

    await queryRunner.query(`
      CREATE TYPE "public"."attempt_outcome_enum" AS ENUM(
        'success',
        'retryable_failure',
        'permanent_failure',
        'timeout',
        'circuit_open'
      )
    `);

    // payments table
    await queryRunner.query(`
      CREATE TABLE "payments" (
        "id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
        "order_id"             varchar(64) NOT NULL,
        "amount"                numeric(12,2) NOT NULL,
        "currency"              char(3) NOT NULL DEFAULT 'IDR',
        "status"                "public"."payment_status_enum" NOT NULL DEFAULT 'processing',
        "gateway_reference"     varchar(64),
        "attempt_count"         int NOT NULL DEFAULT 0,
        "total_retry_count"     int NOT NULL DEFAULT 0,
        "next_retry_at"         timestamp(3),
        "failure_reason"        varchar(500),
        "created_at"            timestamp(3) NOT NULL DEFAULT now(),
        "updated_at"            timestamp(3) NOT NULL DEFAULT now(),
        CONSTRAINT "pk_payments" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`CREATE UNIQUE INDEX "idx_payments_order_id" ON "payments" ("order_id")`);
    await queryRunner.query(`CREATE INDEX "idx_payments_status" ON "payments" ("status")`);
    await queryRunner.query(`CREATE INDEX "idx_payments_next_retry_at" ON "payments" ("next_retry_at")`);

    // payment_attempts table
    await queryRunner.query(`
      CREATE TABLE "payment_attempts" (
        "id"                    uuid NOT NULL DEFAULT gen_random_uuid(),
        "payment_id"            uuid NOT NULL,
        "attempt_number"        int NOT NULL,
        "outcome"               "public"."attempt_outcome_enum" NOT NULL,
        "http_status"           int,
        "error_code"             varchar,
        "error_message"          varchar,
        "delay_before_next_ms"   int,
        "breaker_state"          varchar(12) NOT NULL,
        "duration_ms"            int NOT NULL,
        "trace_id"               char(32),
        "idempotency_key"        varchar(64) NOT NULL,
        "gateway_reference"      varchar(64),
        "replayed"               boolean NOT NULL DEFAULT false,
        "created_at"             timestamp(3) NOT NULL DEFAULT now(),
        CONSTRAINT "pk_payment_attempts" PRIMARY KEY ("id"),
        CONSTRAINT "fk_payment_attempts_payment_id"
          FOREIGN KEY ("payment_id")
          REFERENCES "payments" ("id")
          ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`CREATE INDEX "idx_payment_attempts_payment_id" ON "payment_attempts" ("payment_id")`);
    await queryRunner.query(`CREATE INDEX "idx_payment_attempts_idempotency_key" ON "payment_attempts" ("idempotency_key")`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_payment_attempts_idempotency_key"`);
    await queryRunner.query(`DROP INDEX "public"."idx_payment_attempts_payment_id"`);
    await queryRunner.query(`DROP TABLE "public"."payment_attempts"`);

    await queryRunner.query(`DROP INDEX "public"."idx_payments_next_retry_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_payments_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_payments_order_id"`);
    await queryRunner.query(`DROP TABLE "public"."payments"`);

    await queryRunner.query(`DROP TYPE "public"."attempt_outcome_enum"`);
    await queryRunner.query(`DROP TYPE "public"."payment_status_enum"`);
  }
}
