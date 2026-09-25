import { describe, it, expect, jest } from '@jest/globals';
import { RetrySchedulerService } from '../../../src/modules/retry-scheduler/retry-scheduler.service';
import { PaymentsService } from '../../../src/modules/payments/payments.service';
import { PaymentRepository } from '../../../src/database/repositories/payment.repository';
import { PaymentStatus } from '../../../src/database/entities/enums';
import type { Payment } from '../../../src/database/entities/payment.entity';

function makePayment(overrides: Partial<Payment> = {}): Payment {
  return {
    id: 'pay-001',
    orderId: 'ORD-001',
    amount: '100.00',
    currency: 'IDR',
    status: PaymentStatus.SCHEDULED_FOR_RETRY,
    gatewayReference: null,
    attemptCount: 3,
    totalRetryCount: 1,
    nextRetryAt: new Date(Date.now() - 1000),
    failureReason: 'server_error',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Payment;
}

function makeConfigService(overrides: Record<string, number> = {}) {
  return {
    get: jest.fn((key: string) => {
      const defaults: Record<string, number> = {
        SCHEDULER_INTERVAL_MS: 5000,
        SCHEDULER_BATCH_SIZE: 50,
        MAX_TOTAL_RETRIES: 5,
      };
      return overrides[key] ?? defaults[key];
    }),
  } as never;
}

function makeSchedulerRegistry() {
  return {
    addInterval: jest.fn(),
    deleteInterval: jest.fn(() => {
      throw new Error('not found');
    }),
    getIntervals: jest.fn(() => []),
  } as unknown as import('@nestjs/schedule').SchedulerRegistry;
}

function makeMockPaymentsService() {
  return {
    executePayment: jest.fn(async () => makePayment({ status: PaymentStatus.SUCCEEDED })),
  } as unknown as PaymentsService;
}

function makeMockRepo(duePayments: Payment[] = []) {
  return {
    findDueRetries: jest.fn(async () => duePayments),
    // atomicUpdateStatus is called by RetrySchedulerService.processOne()
    // to increment totalRetryCount and to mark payments as failed when
    // MAX_TOTAL_RETRIES is exceeded (PLAN1 section 10.2 + section 12).
    // Returns true to simulate successful conditional update.
    atomicUpdateStatus: jest.fn(async () => true),
  } as unknown as PaymentRepository;
}

describe('RetrySchedulerService - poll', () => {
  it('does nothing when no due payments', async () => {
    const svc = new RetrySchedulerService(
      makeMockPaymentsService(),
      makeMockRepo([]),
      makeConfigService(),
      makeSchedulerRegistry(),
    );

    await svc.poll();

    const stats = svc.getStats();
    expect(stats.processedCount).toBe(0);
    expect(stats.errorCount).toBe(0);
    expect(stats.lastPollAt).not.toBeNull();
  });

  it('processes due payments via executePayment(source=scheduler)', async () => {
    const paymentsService = makeMockPaymentsService();
    const duePayments = [makePayment({ id: 'pay-1' }), makePayment({ id: 'pay-2' })];
    const svc = new RetrySchedulerService(
      paymentsService,
      makeMockRepo(duePayments),
      makeConfigService(),
      makeSchedulerRegistry(),
    );

    await svc.poll();

    expect(paymentsService.executePayment).toHaveBeenCalledTimes(2);
    expect(paymentsService.executePayment).toHaveBeenCalledWith('pay-1', { source: 'scheduler' });
    expect(paymentsService.executePayment).toHaveBeenCalledWith('pay-2', { source: 'scheduler' });
    expect(svc.getStats().processedCount).toBe(2);
  });

  it('continues to next payment when one fails (does NOT crash)', async () => {
    const paymentsService = makeMockPaymentsService();
    (paymentsService.executePayment as ReturnType<typeof jest.fn>)
      .mockResolvedValueOnce(makePayment({ id: 'pay-1', status: PaymentStatus.SUCCEEDED }))
      .mockRejectedValueOnce(new Error('concurrent modification'))
      .mockResolvedValueOnce(makePayment({ id: 'pay-3', status: PaymentStatus.SUCCEEDED }));

    const duePayments = [
      makePayment({ id: 'pay-1' }),
      makePayment({ id: 'pay-2' }),
      makePayment({ id: 'pay-3' }),
    ];
    const svc = new RetrySchedulerService(
      paymentsService,
      makeMockRepo(duePayments),
      makeConfigService(),
      makeSchedulerRegistry(),
    );

    await svc.poll();

    expect(paymentsService.executePayment).toHaveBeenCalledTimes(3);
    expect(svc.getStats().processedCount).toBe(2);
    expect(svc.getStats().errorCount).toBe(1);
    expect(svc.getStats().lastError).toBe('concurrent modification');
  });

  it('catches DB query error without crashing', async () => {
    const repo = makeMockRepo([]);
    repo.findDueRetries = jest.fn(async () => {
      throw new Error('DB connection lost');
    });

    const svc = new RetrySchedulerService(
      makeMockPaymentsService(),
      repo,
      makeConfigService(),
      makeSchedulerRegistry(),
    );

    await svc.poll();

    expect(svc.getStats().errorCount).toBe(1);
    expect(svc.getStats().lastError).toBe('DB connection lost');
  });

  it('skips cycle when already running (re-entrancy guard)', async () => {
    const repo = makeMockRepo([makePayment({ id: 'pay-1' })]);
    let resolveFirst: () => void;
    const firstCall = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const paymentsService = makeMockPaymentsService();
    paymentsService.executePayment = jest.fn(async () => {
      await firstCall;
      return makePayment({ status: PaymentStatus.SUCCEEDED });
    });

    const svc = new RetrySchedulerService(
      paymentsService,
      repo,
      makeConfigService(),
      makeSchedulerRegistry(),
    );

    // Start first poll (don't await yet)
    const firstPoll = svc.poll();
    // Try second poll while first is still running
    await svc.poll();

    // Yield to microtask queue so first poll can progress through:
    //   findDueRetries (1 hop) -> atomicUpdateStatus (1 hop) -> executePayment
    // The extra hop is needed because processOne now awaits atomicUpdateStatus
    // before calling executePayment (PLAN1 section 10.2 + section 12).
    await Promise.resolve();
    await Promise.resolve();

    expect(paymentsService.executePayment).toHaveBeenCalledTimes(1);

    // Let first poll finish
    resolveFirst!();
    await firstPoll;
  });
});

describe('RetrySchedulerService - getStats', () => {
  it('returns initial stats before any poll', () => {
    const svc = new RetrySchedulerService(
      makeMockPaymentsService(),
      makeMockRepo([]),
      makeConfigService({ SCHEDULER_INTERVAL_MS: 3000, SCHEDULER_BATCH_SIZE: 10, MAX_TOTAL_RETRIES: 3 }),
      makeSchedulerRegistry(),
    );

    const stats = svc.getStats();
    expect(stats.status).toBe('idle');
    expect(stats.lastPollAt).toBeNull();
    expect(stats.processedCount).toBe(0);
    expect(stats.errorCount).toBe(0);
    expect(stats.lastError).toBeNull();
    expect(stats.intervalMs).toBe(3000);
    expect(stats.batchSize).toBe(10);
    expect(stats.maxTotalRetries).toBe(3);
  });

  it('returns running status during poll', async () => {
    const repo = makeMockRepo([makePayment({ id: 'pay-1' })]);
    let resolvePoll!: () => void;
    const pollGate = new Promise<void>((resolve) => {
      resolvePoll = resolve;
    });
    const paymentsService = makeMockPaymentsService();
    (paymentsService.executePayment as ReturnType<typeof jest.fn>).mockImplementation(async () => {
      await pollGate;
      return makePayment({ status: PaymentStatus.SUCCEEDED });
    });

    const svc = new RetrySchedulerService(
      paymentsService,
      repo,
      makeConfigService(),
      makeSchedulerRegistry(),
    );

    const pollPromise = svc.poll();

    // Stats should show running during poll
    expect(svc.getStats().status).toBe('running');

    resolvePoll();
    await pollPromise;

    expect(svc.getStats().status).toBe('idle');
  });
});

describe('RetrySchedulerService - onApplicationBootstrap', () => {
  it('registers interval via SchedulerRegistry', async () => {
    const schedulerRegistry = makeSchedulerRegistry();
    let intervalRef: ReturnType<typeof setInterval> | undefined;
    // Capture the interval ref so we can clear it after test
    (schedulerRegistry.addInterval as ReturnType<typeof jest.fn>).mockImplementation(
      (_name: string, ref: ReturnType<typeof setInterval>) => {
        intervalRef = ref;
      },
    );
    const svc = new RetrySchedulerService(
      makeMockPaymentsService(),
      makeMockRepo([]),
      makeConfigService({ SCHEDULER_INTERVAL_MS: 999999 }),
      schedulerRegistry,
    );

    await svc.onApplicationBootstrap();

    expect(schedulerRegistry.addInterval).toHaveBeenCalledTimes(1);
    expect(schedulerRegistry.deleteInterval).toHaveBeenCalledTimes(1);

    // Clean up interval to prevent Jest open handle
    if (intervalRef) clearInterval(intervalRef);
  });
});
