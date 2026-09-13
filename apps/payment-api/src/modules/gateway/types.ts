/**
 * Gateway types (plan section 2.2 + 9).
 */

export interface ChargeRequest {
  paymentId: string;
  orderId: string;
  amount: string;
  currency: string;
}

export type ChargeStatus = 'succeeded' | 'failed';

export interface ChargeResult {
  status: ChargeStatus;
  httpStatus?: number;
  gatewayReference?: string;
  replayed: boolean;
  errorCode?: string;
  errorMessage?: string;
  retryAfterMs?: number;
  attempts?: number;
}

export interface GatewayAttemptContext {
  paymentId: string;
  attemptNumber: number;
  startedAt: Date;
  finishedAt: Date;
  result: ChargeResult;
  breakerState?: 'closed' | 'open' | 'half_open';
}

export type OnAttemptCallback = (ctx: GatewayAttemptContext) => void | Promise<void>;
