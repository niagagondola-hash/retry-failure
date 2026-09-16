import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { AttemptOutcome } from './enums';
import { Payment } from './payment.entity';

/**
 * PaymentAttempt entity (plan section 11.2 rev 2 — PostgreSQL-native).
 *
 * Native PG types:
 *   - id: uuid
 *   - payment_id: uuid FK -> payments.id ON DELETE CASCADE
 *   - outcome: native PG enum attempt_outcome_enum
 *   - created_at: timestamp(3) (ms precision)
 *
 * Definite assignment assertion `!` wajib (TypeORM reflection pattern + strict mode).
 */
@Entity('payment_attempts')
@Index('idx_payment_attempts_payment_id', ['paymentId'])
@Index('idx_payment_attempts_idempotency_key', ['idempotencyKey'])
export class PaymentAttempt {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'payment_id', type: 'uuid' })
  paymentId!: string;

  @Column({ name: 'attempt_number', type: 'int' })
  attemptNumber!: number;

  @Column({ type: 'enum', enum: AttemptOutcome })
  outcome!: AttemptOutcome;

  @Column({ name: 'http_status', type: 'int', nullable: true })
  httpStatus: number | null = null;

  @Column({ name: 'error_code', type: 'varchar', nullable: true })
  errorCode: string | null = null;

  @Column({ name: 'error_message', type: 'varchar', nullable: true })
  errorMessage: string | null = null;

  @Column({ name: 'delay_before_next_ms', type: 'int', nullable: true })
  delayBeforeNextMs: number | null = null;

  @Column({ name: 'breaker_state', type: 'varchar', length: 12 })
  breakerState!: string;

  @Column({ name: 'duration_ms', type: 'int' })
  durationMs!: number;

  @Column({ name: 'trace_id', type: 'varchar', length: 64, nullable: true })
  traceId: string | null = null;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 64 })
  idempotencyKey!: string;

  @Column({ name: 'gateway_reference', type: 'varchar', length: 64, nullable: true })
  gatewayReference: string | null = null;

  @Column({ name: 'replayed', type: 'boolean', default: false })
  replayed: boolean = false;

  @CreateDateColumn({ name: 'created_at', type: 'timestamp', precision: 3 })
  createdAt!: Date;

  @ManyToOne(() => Payment, (p) => p.attempts, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'payment_id' })
  payment?: Payment;
}
