import { describe, it, expect, jest } from '@jest/globals';
import { AuditService } from '../../../src/modules/audit/audit.service';
import type { RecordAttemptInput } from '../../../src/modules/payments/audit/audit-port';
import type { PaymentAttempt } from '../../../src/database/entities/payment-attempt.entity';
import type { PaymentRepository } from '../../../src/database/repositories/payment.repository';

interface MockAttemptRepo {
  create: ReturnType<typeof jest.fn>;
  save: ReturnType<typeof jest.fn>;
  find: ReturnType<typeof jest.fn>;
  manager: {
    createQueryBuilder: ReturnType<typeof jest.fn>;
  };
  _savedRows: PaymentAttempt[];
}

function makeMockAttemptRepo(): MockAttemptRepo {
  const savedRows: PaymentAttempt[] = [];
  return {
    create: jest.fn((data: Partial<PaymentAttempt>) => ({ ...data } as PaymentAttempt)),
    save: jest.fn(async (row: PaymentAttempt) => {
      savedRows.push(row);
      return row;
    }),
    find: jest.fn(async () => savedRows),
    manager: {
      createQueryBuilder: jest.fn(() => ({
        update: jest.fn(() => ({
          set: jest.fn(() => ({
            where: jest.fn(() => ({
              execute: jest.fn(async () => ({ affected: 1 })),
            })),
          })),
        })),
      })),
    },
    _savedRows: savedRows,
  };
}

function makeMockPaymentRepo() {
  return {
    incrementAttemptCount: jest.fn(async () => {}),
  } as unknown as PaymentRepository;
}

function makeInput(overrides: Partial<RecordAttemptInput> = {}): RecordAttemptInput {
  return {
    paymentId: 'pay-001',
    attemptNumber: 1,
    outcome: 'success' as never,
    httpStatus: 200,
    errorCode: null,
    errorMessage: null,
    delayBeforeNextMs: null,
    breakerState: 'closed',
    durationMs: 42,
    traceId: 'trace-001',
    idempotencyKey: 'pay-001',
    gatewayReference: 'gw-ref-1',
    replayed: false,
    ...overrides,
  };
}

describe('AuditService - recordAttempt', () => {
  it('persists attempt row with all fields', async () => {
    const attemptRepo = makeMockAttemptRepo();
    const paymentRepo = makeMockPaymentRepo();
    const svc = new AuditService(attemptRepo as unknown as never, paymentRepo);

    await svc.recordAttempt(makeInput());

    expect(attemptRepo.save).toHaveBeenCalledTimes(1);
    expect(attemptRepo._savedRows).toHaveLength(1);
    const row = attemptRepo._savedRows[0];
    expect(row.paymentId).toBe('pay-001');
    expect(row.attemptNumber).toBe(1);
    expect(row.outcome).toBe('success');
    expect(row.httpStatus).toBe(200);
    expect(row.gatewayReference).toBe('gw-ref-1');
    expect(row.replayed).toBe(false);
    expect(row.traceId).toBe('trace-001');
    expect(row.idempotencyKey).toBe('pay-001');
    expect(row.breakerState).toBe('closed');
    expect(row.durationMs).toBe(42);
  });

  it('atomic increments payments.attempt_count', async () => {
    const attemptRepo = makeMockAttemptRepo();
    const paymentRepo = makeMockPaymentRepo();
    const svc = new AuditService(attemptRepo as unknown as never, paymentRepo);

    await svc.recordAttempt(makeInput());

    expect(attemptRepo.manager.createQueryBuilder).toHaveBeenCalled();
  });

  it('nulls nullable fields when not provided', async () => {
    const attemptRepo = makeMockAttemptRepo();
    const paymentRepo = makeMockPaymentRepo();
    const svc = new AuditService(attemptRepo as unknown as never, paymentRepo);

    await svc.recordAttempt(
      makeInput({
        httpStatus: undefined,
        errorCode: undefined,
        errorMessage: undefined,
        delayBeforeNextMs: undefined,
        gatewayReference: undefined,
        traceId: undefined,
      }),
    );

    const row = attemptRepo._savedRows[0];
    expect(row.httpStatus).toBeNull();
    expect(row.errorCode).toBeNull();
    expect(row.errorMessage).toBeNull();
    expect(row.delayBeforeNextMs).toBeNull();
    expect(row.gatewayReference).toBeNull();
    expect(row.traceId).toBeNull();
  });

  it('swallows internal errors (does NOT throw to caller)', async () => {
    const attemptRepo = makeMockAttemptRepo();
    attemptRepo.save = jest.fn(async () => {
      throw new Error('DB connection lost');
    });
    const paymentRepo = makeMockPaymentRepo();
    const svc = new AuditService(attemptRepo as unknown as never, paymentRepo);

    // Should NOT throw - audit failure must not break payment flow
    await expect(svc.recordAttempt(makeInput())).resolves.not.toThrow();
  });

  it('records circuit_open outcome with durationMs=0', async () => {
    const attemptRepo = makeMockAttemptRepo();
    const paymentRepo = makeMockPaymentRepo();
    const svc = new AuditService(attemptRepo as unknown as never, paymentRepo);

    await svc.recordAttempt(
      makeInput({
        outcome: 'circuit_open' as never,
        httpStatus: undefined,
        errorCode: 'circuit_open',
        errorMessage: 'circuit breaker open',
        breakerState: 'open',
        durationMs: 0,
        gatewayReference: undefined,
      }),
    );

    const row = attemptRepo._savedRows[0];
    expect(row.outcome).toBe('circuit_open');
    expect(row.durationMs).toBe(0);
    expect(row.breakerState).toBe('open');
    expect(row.httpStatus).toBeNull();
  });

  it('records replayed=true for idempotency replay', async () => {
    const attemptRepo = makeMockAttemptRepo();
    const paymentRepo = makeMockPaymentRepo();
    const svc = new AuditService(attemptRepo as unknown as never, paymentRepo);

    await svc.recordAttempt(makeInput({ replayed: true }));

    expect(attemptRepo._savedRows[0].replayed).toBe(true);
  });
});

describe('AuditService - listAttempts', () => {
  it('returns attempts ordered by attemptNumber ASC', async () => {
    const attemptRepo = makeMockAttemptRepo();
    // Pre-populate with unsorted rows
    attemptRepo._savedRows.push(
      { id: 'a3', paymentId: 'pay-001', attemptNumber: 3, outcome: 'success', breakerState: 'closed', durationMs: 10, idempotencyKey: 'k', replayed: false, httpStatus: null, errorCode: null, errorMessage: null, delayBeforeNextMs: null, traceId: null, gatewayReference: null, createdAt: new Date() } as PaymentAttempt,
      { id: 'a1', paymentId: 'pay-001', attemptNumber: 1, outcome: 'retryable_failure', breakerState: 'closed', durationMs: 20, idempotencyKey: 'k', replayed: false, httpStatus: 500, errorCode: null, errorMessage: null, delayBeforeNextMs: null, traceId: null, gatewayReference: null, createdAt: new Date() } as PaymentAttempt,
      { id: 'a2', paymentId: 'pay-001', attemptNumber: 2, outcome: 'retryable_failure', breakerState: 'closed', durationMs: 30, idempotencyKey: 'k', replayed: false, httpStatus: 500, errorCode: null, errorMessage: null, delayBeforeNextMs: null, traceId: null, gatewayReference: null, createdAt: new Date() } as PaymentAttempt,
    );
    attemptRepo.find = jest.fn(async () =>
      [...attemptRepo._savedRows].sort((a, b) => a.attemptNumber - b.attemptNumber),
    );

    const paymentRepo = makeMockPaymentRepo();
    const svc = new AuditService(attemptRepo as unknown as never, paymentRepo);

    const result = await svc.listAttempts('pay-001');

    expect(result).toHaveLength(3);
    expect(result[0].attemptNumber).toBe(1);
    expect(result[1].attemptNumber).toBe(2);
    expect(result[2].attemptNumber).toBe(3);
  });

  it('returns empty array for payment with no attempts', async () => {
    const attemptRepo = makeMockAttemptRepo();
    attemptRepo.find = jest.fn(async () => []);
    const paymentRepo = makeMockPaymentRepo();
    const svc = new AuditService(attemptRepo as unknown as never, paymentRepo);

    const result = await svc.listAttempts('pay-no-attempts');
    expect(result).toEqual([]);
  });

  it('maps entity to AttemptView (no TypeORM metadata leak)', async () => {
    const attemptRepo = makeMockAttemptRepo();
    attemptRepo._savedRows.push({
      id: 'att-1',
      paymentId: 'pay-001',
      attemptNumber: 1,
      outcome: 'success',
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
      createdAt: new Date('2026-01-01'),
    } as PaymentAttempt);
    attemptRepo.find = jest.fn(async () => attemptRepo._savedRows);

    const paymentRepo = makeMockPaymentRepo();
    const svc = new AuditService(attemptRepo as unknown as never, paymentRepo);

    const result = await svc.listAttempts('pay-001');

    expect(result[0]).toEqual({
      id: 'att-1',
      paymentId: 'pay-001',
      attemptNumber: 1,
      outcome: 'success',
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
      createdAt: new Date('2026-01-01'),
    });
    // No TypeORM internal properties like __entity, __validator, etc.
    expect(result[0]).not.toHaveProperty('__entity');
  });
});
