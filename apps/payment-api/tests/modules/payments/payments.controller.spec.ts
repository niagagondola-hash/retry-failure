import { describe, it, expect, jest } from '@jest/globals';
import { PaymentsController } from '../../../src/modules/payments/payments.controller';
import { PaymentsService } from '../../../src/modules/payments/payments.service';
import { PaymentStatus } from '../../../src/database/entities/enums';
import type { PaymentView } from '../../../src/modules/payments/payments.service';

function makePaymentView(overrides: Partial<PaymentView> = {}): PaymentView {
  return {
    id: 'pay-001',
    orderId: 'ORD-001',
    amount: '100.00',
    currency: 'IDR',
    status: PaymentStatus.SUCCEEDED,
    gatewayReference: 'gw-ref-1',
    attemptCount: 1,
    totalRetryCount: 0,
    nextRetryAt: null,
    failureReason: null,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...overrides,
  };
}

function makeMockService() {
  return {
    createPayment: jest.fn(async () => makePaymentView()),
    list: jest.fn(async () => [makePaymentView(), makePaymentView({ id: 'pay-002' })]),
    getById: jest.fn(async () => ({
      ...makePaymentView(),
      attempts: [],
    })),
    manualRetry: jest.fn(async () => makePaymentView({ status: PaymentStatus.SUCCEEDED })),
  } as unknown as PaymentsService;
}

describe('PaymentsController — create', () => {
  it('returns 201 with payment response', async () => {
    const svc = makeMockService();
    const ctrl = new PaymentsController(svc);

    const result = await ctrl.create({
      orderId: 'ORD-1',
      amount: 100,
      currency: 'IDR',
    });

    expect(result.payment).toBeDefined();
    expect(result.payment.id).toBe('pay-001');
    expect(result.payment.status).toBe(PaymentStatus.SUCCEEDED);
    expect(result.payment.amount).toBe(100); // Number(amount) conversion
    expect(svc.createPayment).toHaveBeenCalledWith({
      orderId: 'ORD-1',
      amount: 100,
      currency: 'IDR',
    });
  });
});

describe('PaymentsController — list', () => {
  it('returns payments with limit + offset echo', async () => {
    const svc = makeMockService();
    const ctrl = new PaymentsController(svc);

    const result = await ctrl.list({ status: PaymentStatus.SUCCEEDED, limit: 50, offset: 0 });

    expect(result.payments).toHaveLength(2);
    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
    expect(svc.list).toHaveBeenCalledWith({ status: PaymentStatus.SUCCEEDED });
  });

  it('applies pagination (offset + limit slicing)', async () => {
    const svc = makeMockService();
    // Return 5 items
    svc.list = jest.fn(async () =>
      Array.from({ length: 5 }, (_, i) => makePaymentView({ id: `pay-${i + 1}` })),
    ) as never;
    const ctrl = new PaymentsController(svc);

    const result = await ctrl.list({ limit: 2, offset: 1 });

    expect(result.payments).toHaveLength(2);
    expect(result.payments[0].id).toBe('pay-2');
    expect(result.payments[1].id).toBe('pay-3');
  });
});

describe('PaymentsController — getById', () => {
  it('returns payment detail with attempts', async () => {
    const svc = makeMockService();
    svc.getById = jest.fn(async () => ({
      ...makePaymentView(),
      attempts: [
        {
          id: 'att-1',
          paymentId: 'pay-001',
          attemptNumber: 1,
          outcome: 'success' as never,
          httpStatus: 200,
          errorCode: null,
          errorMessage: null,
          delayBeforeNextMs: null,
          breakerState: 'closed',
          durationMs: 42,
          traceId: 'trace-1',
          idempotencyKey: 'pay-001',
          gatewayReference: 'gw-1',
          replayed: false,
          createdAt: new Date(),
        },
      ],
    })) as never;
    const ctrl = new PaymentsController(svc);

    const result = await ctrl.getById('pay-001');

    expect(result.payment.id).toBe('pay-001');
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].gatewayReference).toBe('gw-1');
  });
});

describe('PaymentsController — retry', () => {
  it('returns payment after retry', async () => {
    const svc = makeMockService();
    const ctrl = new PaymentsController(svc);

    const result = await ctrl.retry('pay-001');

    expect(result.payment.status).toBe(PaymentStatus.SUCCEEDED);
    expect(svc.manualRetry).toHaveBeenCalledWith('pay-001');
  });

  it('throws ConflictException for InvalidTransitionError', async () => {
    const svc = makeMockService();
    const { InvalidTransitionError } = await import('../../../src/modules/payments/state-machine');
    svc.manualRetry = jest.fn(async () => {
      throw new InvalidTransitionError(PaymentStatus.SUCCEEDED, PaymentStatus.PROCESSING);
    }) as never;
    const ctrl = new PaymentsController(svc);

    await expect(ctrl.retry('pay-001')).rejects.toThrow('retry not allowed');
  });

  it('re-throws unknown errors (not InvalidTransitionError)', async () => {
    const svc = makeMockService();
    svc.manualRetry = jest.fn(async () => {
      throw new Error('Unexpected error');
    }) as never;
    const ctrl = new PaymentsController(svc);

    await expect(ctrl.retry('pay-001')).rejects.toThrow('Unexpected error');
  });
});
