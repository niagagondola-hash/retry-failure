/**
 * PostgreSQL-native enums for payment domain (plan section 11).
 *
 * TypeORM dengan PostgreSQL akan create native enum type (`CREATE TYPE ... AS ENUM`)
 * bila kolom dideklarasikan dengan `type: 'enum'` + `enum: SomeEnum`.
 */

export enum PaymentStatus {
  PROCESSING = 'processing',
  SUCCEEDED = 'succeeded',
  FAILED = 'failed',
  SCHEDULED_FOR_RETRY = 'scheduled_for_retry',
}

export enum AttemptOutcome {
  SUCCESS = 'success',
  RETRYABLE_FAILURE = 'retryable_failure',
  PERMANENT_FAILURE = 'permanent_failure',
  TIMEOUT = 'timeout',
  CIRCUIT_OPEN = 'circuit_open',
}

export enum BreakerState {
  CLOSED = 'closed',
  OPEN = 'open',
  HALF_OPEN = 'half_open',
}
