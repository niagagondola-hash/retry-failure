import { PaymentStatus } from '../../database/entities/enums';

export const VALID_TRANSITIONS: Readonly<Record<PaymentStatus, readonly PaymentStatus[]>> = {
  [PaymentStatus.PROCESSING]: [
    PaymentStatus.PROCESSING, // idempotent: start new cycle from already-processing (source='api')
    PaymentStatus.SUCCEEDED,
    PaymentStatus.FAILED,
    PaymentStatus.SCHEDULED_FOR_RETRY,
  ],
  [PaymentStatus.SCHEDULED_FOR_RETRY]: [
    PaymentStatus.PROCESSING,
    PaymentStatus.FAILED,
  ],
  [PaymentStatus.FAILED]: [
    PaymentStatus.PROCESSING,
  ],
  [PaymentStatus.SUCCEEDED]: [],
};

export class InvalidTransitionError extends Error {
  constructor(
    public readonly from: PaymentStatus,
    public readonly to: PaymentStatus,
  ) {
    super(`Invalid status transition: ${from} -> ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function isTerminal(status: PaymentStatus): boolean {
  return status === PaymentStatus.SUCCEEDED || status === PaymentStatus.FAILED;
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  const allowed = VALID_TRANSITIONS[from] ?? [];
  return allowed.includes(to);
}

export function assertCanTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}
