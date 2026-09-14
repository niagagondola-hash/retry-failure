import { paymentClient } from './setup';

export interface PaymentView {
  id: string;
  orderId: string;
  amount: number;
  currency: string;
  status: 'processing' | 'succeeded' | 'failed' | 'scheduled_for_retry';
  gatewayReference: string | null;
  attemptCount: number;
  totalRetryCount: number;
  nextRetryAt: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AttemptView {
  id: string;
  paymentId: string;
  attemptNumber: number;
  outcome: string;
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
  createdAt: string;
}

export interface PaymentDetail {
  payment: PaymentView;
  attempts: AttemptView[];
}

export async function createPayment(body: { orderId: string; amount: number; currency: string }): Promise<PaymentView> {
  const { data } = await paymentClient.post<{ payment: PaymentView }>('/payments', body);
  return data.payment;
}

export async function getPayment(id: string): Promise<PaymentDetail> {
  const { data } = await paymentClient.get<PaymentDetail>(`/payments/${id}`);
  return data;
}

export async function waitForTerminalStatus(id: string, timeoutMs = 60000): Promise<PaymentDetail> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const detail = await getPayment(id);
    if (['succeeded', 'failed'].includes(detail.payment.status)) {
      return detail;
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Payment ${id} did not reach terminal status within ${timeoutMs}ms`);
}

export async function waitForScheduledForRetry(id: string, timeoutMs = 30000): Promise<PaymentView> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { payment } = await getPayment(id);
    if (payment.status === 'scheduled_for_retry') return payment;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Payment ${id} did not reach scheduled_for_retry within ${timeoutMs}ms`);
}

export async function waitForFailed(id: string, timeoutMs = 120000): Promise<PaymentView> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const { payment } = await getPayment(id);
    if (payment.status === 'failed') return payment;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Payment ${id} did not reach failed within ${timeoutMs}ms`);
}
