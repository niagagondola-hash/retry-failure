import type { AttemptOutcome } from '../../../database/entities/enums';

export const AUDIT_PORT = Symbol('AUDIT_PORT');

export interface RecordAttemptInput {
  paymentId: string;
  attemptNumber: number;
  outcome: AttemptOutcome;
  httpStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  delayBeforeNextMs?: number | null;
  breakerState: 'closed' | 'open' | 'half_open';
  durationMs: number;
  traceId?: string | null;
  idempotencyKey: string;
  gatewayReference?: string | null;
  replayed: boolean;
}

export interface AttemptView {
  id: string;
  paymentId: string;
  attemptNumber: number;
  outcome: AttemptOutcome;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  delayBeforeNextMs: number | null;
  breakerState: string;
  durationMs: number;
  traceId: string | null;
  idempotencyKey: string;
  gatewayReference: string | null;
  replayed: boolean;
  createdAt: Date;
}

export interface AuditPort {
  recordAttempt(input: RecordAttemptInput): Promise<void>;
  listAttempts(paymentId: string): Promise<AttemptView[]>;
}

export class NoopAuditService implements AuditPort {
  async recordAttempt(_input: RecordAttemptInput): Promise<void> {}
  async listAttempts(_paymentId: string): Promise<AttemptView[]> {
    return [];
  }
}
