import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Migration 0002 - Fix trace_id column type (TASK-14a follow-up).
 *
 * Bug context:
 *   - Schema 0001 defined `trace_id char(32)`.
 *   - `PaymentsService` generates traceId via `randomUUID()` -> 36 chars (UUIDv4 with hyphens).
 *   - INSERT failed: "value too long for type character(32)".
 *   - `AuditService.recordAttempt` swallowed the error -> silent audit loss.
 *   - Test scenario 3 (circuit-breaker) failed with attemptCount=0.
 *
 * Fix:
 *   - ALTER COLUMN trace_id TYPE varchar(64).
 *   - varchar(64) accommodates UUIDv4 (36), W3C TraceParent (55), and future OTel IDs.
 *   - No data loss (existing rows have NULL or 32-char trace_id, both fit varchar(64)).
 *
 * Entity update:
 *   - payment-attempt.entity.ts: `@Column({ type: 'varchar', length: 64, nullable: true })`
 */
export class TraceIdVarchar0002170000000001 implements MigrationInterface {
  name = 'TraceIdVarchar0002170000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "payment_attempts"
      ALTER COLUMN "trace_id" TYPE varchar(64)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Down migration: truncate trace_id to 32 chars (lossy) and convert back to char(32).
    await queryRunner.query(`
      UPDATE "payment_attempts"
      SET "trace_id" = LEFT("trace_id", 32)
      WHERE "trace_id" IS NOT NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "payment_attempts"
      ALTER COLUMN "trace_id" TYPE char(32)
    `);
  }
}
