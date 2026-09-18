import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToMany,
} from 'typeorm';
import { PaymentStatus } from './enums';
import { PaymentAttempt } from './payment-attempt.entity';
import { getTimestampColumnType } from '../helpers/db-types.helper';

/**
 * Payment entity (plan section 11.1 rev 2 - PostgreSQL-native).
 *
 * Native PG types:
 *   - id: uuid (default gen_random_uuid())
 *   - amount: numeric(12,2) -> JS string (preserve precision)
 *   - status: native PG enum payment_status_enum
 *   - next_retry_at, created_at, updated_at: timestamp(3) (ms precision)
 *
 * Definite assignment assertion `!` wajib karena TypeORM meng-set properties
 * via reflection setelah constructor. strictPropertyInitialization true di tsconfig.
 */
@Entity('payments')
@Index('idx_payments_status', ['status'])
@Index('idx_payments_next_retry_at', ['nextRetryAt'])
export class Payment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'order_id', type: 'varchar', length: 64, unique: true })
  orderId!: string;

  @Column({ type: 'numeric', precision: 12, scale: 2 })
  amount!: string; // numeric returns string to preserve precision

  @Column({ type: 'varchar', length: 3, default: 'IDR' })
  currency!: string;

  @Column({ type: 'varchar', length: 30, default: PaymentStatus.PROCESSING })
  status!: PaymentStatus;

  @Column({ name: 'gateway_reference', type: 'varchar', length: 64, nullable: true })
  gatewayReference: string | null = null;

  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;

  @Column({ name: 'total_retry_count', type: 'int', default: 0 })
  totalRetryCount!: number;

  // Note: 'date' type is supported by both PostgreSQL and SQLite drivers.
  // It stores date+time as ISO string. Precision is second-level (no ms).
  // For ms precision, PostgreSQL migration uses timestamp(3) (hardcoded SQL).
  // Entity type 'date' is only used for runtime validation, not schema creation.
  @Column({ name: 'next_retry_at', type: getTimestampColumnType(), nullable: true })
  nextRetryAt: Date | null = null;

  @Column({ name: 'failure_reason', type: 'varchar', length: 500, nullable: true })
  failureReason: string | null = null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;

  @OneToMany(() => PaymentAttempt, (a) => a.payment)
  attempts?: PaymentAttempt[];
}
