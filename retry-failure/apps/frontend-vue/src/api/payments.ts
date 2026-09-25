import { apiClient } from './client';

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
  outcome: 'success' | 'retryable_failure' | 'permanent_failure' | 'timeout' | 'circuit_open';
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

export async function listPayments(status?: string): Promise<PaymentView[]> {
  const { data } = await apiClient.get<{ payments: PaymentView[] }>('/payments', {
    params: status ? { status } : {},
  });
  return data.payments;
}

export async function getPaymentById(id: string): Promise<PaymentDetail> {
  const { data } = await apiClient.get<PaymentDetail>(`/payments/${id}`);
  return data;
}

export async function createPayment(input: { orderId: string; amount: number; currency: string }): Promise<PaymentView> {
  const { data } = await apiClient.post<{ payment: PaymentView }>('/payments', input);
  return data.payment;
}

export async function retryPayment(id: string): Promise<PaymentView> {
  const { data } = await apiClient.post<{ payment: PaymentView }>(`/payments/${id}/retry`);
  return data.payment;
}
