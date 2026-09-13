import { Injectable, Inject, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { PaymentRepository } from '../../database/repositories/payment.repository';
import { Payment, PaymentStatus } from '../../database/entities';
import { AttemptOutcome } from '../../database/entities/enums';
import {
  PAYMENT_GATEWAY_PORT,
  type PaymentGatewayPort,
  type AttemptObservable,
  type GatewayAttemptContext,
  type ChargeResult,
} from '../gateway';
import { deriveIdempotencyKey } from '../gateway/idempotency-key';
import { AUDIT_PORT, type AuditPort, type RecordAttemptInput, type AttemptView } from './audit/audit-port';
import { assertCanTransition } from './state-machine';
import type { CreatePaymentDto } from './dto/create-payment.dto';

export interface ExecuteOptions {
  source: 'api' | 'scheduler' | 'manual';
}

export interface PaymentView {
  id: string;
  orderId: string;
  amount: string;
  currency: string;
  status: PaymentStatus;
  gatewayReference: string | null;
  attemptCount: number;
  totalRetryCount: number;
  nextRetryAt: Date | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaymentDetail extends PaymentView {
  attempts: AttemptView[];
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly maxTotalRetries: number;
  private readonly schedulerBaseDelayMs: number;

  constructor(
    private readonly payments: PaymentRepository,
    @Inject(PAYMENT_GATEWAY_PORT) private readonly gateway: PaymentGatewayPort,
    @Inject(AUDIT_PORT) private readonly audit: AuditPort,
    config: ConfigService,
  ) {
    this.maxTotalRetries = config.get<number>('MAX_TOTAL_RETRIES') ?? 5;
    this.schedulerBaseDelayMs = config.get<number>('SCHEDULER_BASE_DELAY_MS') ?? 30_000;
  }

  async createPayment(input: CreatePaymentDto): Promise<PaymentView> {
    const amountStr = this.formatAmount(input.amount);
    const payment = await this.payments.create({
      orderId: input.orderId,
      amount: amountStr,
      currency: input.currency,
      status: PaymentStatus.PROCESSING,
      attemptCount: 0,
      totalRetryCount: 0,
      gatewayReference: null,
      nextRetryAt: null,
      failureReason: null,
    });
    this.logger.log({ paymentId: payment.id, orderId: payment.orderId }, 'payment created');

    const updated = await this.executePayment(payment.id, { source: 'api' });
    return this.toView(updated);
  }

  async executePayment(paymentId: string, options: ExecuteOptions): Promise<Payment> {
    const payment = await this.payments.findById(paymentId);
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);

    const previousStatus = payment.status;
    assertCanTransition(previousStatus, PaymentStatus.PROCESSING);

    const switched = await this.payments.atomicUpdateStatus(paymentId, previousStatus, {
      status: PaymentStatus.PROCESSING,
      attemptCount: 0,
      failureReason: null,
    });
    if (!switched) {
      throw new BadRequestException(`Payment ${paymentId} status changed concurrently`);
    }

    const traceId = randomUUID();
    const idempotencyKey = deriveIdempotencyKey(paymentId);

    this.attachAuditCallback(traceId, idempotencyKey);

    let result: ChargeResult;
    try {
      result = await this.gateway.charge({
        paymentId,
        orderId: payment.orderId,
        amount: payment.amount,
        currency: payment.currency,
      });
    } catch (err) {
      this.logger.error({ paymentId, err }, 'gateway.charge threw unexpectedly');
      result = {
        status: 'failed',
        replayed: false,
        errorCode: 'unexpected_exception',
        errorMessage: err instanceof Error ? err.message : String(err),
      };
    }

    return this.applyOutcome(paymentId, result, { traceId, idempotencyKey, source: options.source });
  }

  private async applyOutcome(
    paymentId: string,
    result: ChargeResult,
    ctx: { traceId: string; idempotencyKey: string; source: string },
  ): Promise<Payment> {
    if (this.isPermanentFailure(result)) {
      await this.atomicTransition(paymentId, PaymentStatus.FAILED, {
        failureReason: result.errorMessage ?? result.errorCode ?? 'permanent_failure',
      });
      this.logger.warn({ paymentId, errorCode: result.errorCode }, 'payment permanent failure → failed');
      return (await this.payments.findById(paymentId))!;
    }

    if (result.status === 'succeeded') {
      await this.atomicTransition(paymentId, PaymentStatus.SUCCEEDED, {
        gatewayReference: result.gatewayReference ?? null,
      });
      this.logger.log({ paymentId, gatewayReference: result.gatewayReference }, 'payment succeeded');
      return (await this.payments.findById(paymentId))!;
    }

    if (result.errorCode === 'circuit_open' || result.attempts !== undefined) {
      const current = (await this.payments.findById(paymentId))!;
      const nextTotal = current.totalRetryCount + 1;
      if (nextTotal > this.maxTotalRetries) {
        await this.atomicTransition(paymentId, PaymentStatus.FAILED, {
          failureReason: 'max_total_retries_exceeded',
        });
        this.logger.warn({ paymentId, totalRetryCount: current.totalRetryCount }, 'max_total_retries_exceeded → failed');
        return (await this.payments.findById(paymentId))!;
      }
      const delayMs = result.retryAfterMs ?? this.schedulerBaseDelayMs;
      const nextRetryAt = new Date(Date.now() + delayMs);
      await this.atomicTransition(paymentId, PaymentStatus.SCHEDULED_FOR_RETRY, {
        totalRetryCount: nextTotal,
        nextRetryAt,
        failureReason: result.errorMessage ?? result.errorCode ?? 'retry_exhausted',
      });
      this.logger.log(
        { paymentId, nextRetryAt, totalRetryCount: nextTotal, source: ctx.source },
        'payment scheduled for retry',
      );
      return (await this.payments.findById(paymentId))!;
    }

    await this.atomicTransition(paymentId, PaymentStatus.FAILED, {
      failureReason: result.errorMessage ?? 'unknown_charge_result',
    });
    this.logger.error({ paymentId, result }, 'unknown charge result mapping — fallback to failed');
    return (await this.payments.findById(paymentId))!;
  }

  async manualRetry(paymentId: string): Promise<PaymentView> {
    const payment = await this.payments.findById(paymentId);
    if (!payment) throw new NotFoundException(`Payment ${paymentId} not found`);
    if (payment.status !== PaymentStatus.FAILED && payment.status !== PaymentStatus.SCHEDULED_FOR_RETRY) {
      throw new BadRequestException(`Cannot manualRetry from status=${payment.status}`);
    }
    const updated = await this.executePayment(paymentId, { source: 'manual' });
    return this.toView(updated);
  }

  async getById(id: string): Promise<PaymentDetail> {
    const payment = await this.payments.findById(id);
    if (!payment) throw new NotFoundException(`Payment ${id} not found`);
    const attempts = await this.audit.listAttempts(id);
    return { ...this.toView(payment), attempts };
  }

  async list(filter: { status?: PaymentStatus } = {}): Promise<PaymentView[]> {
    const payments = await this.payments.list(filter);
    return payments.map((p) => this.toView(p));
  }

  private isPermanentFailure(result: ChargeResult): boolean {
    if (result.status === 'succeeded') return false;
    const code = result.errorCode;
    if (code === 'invalid_card' || code === 'insufficient_funds' || code === 'expired_card') return true;
    const http = result.httpStatus;
    if (http !== undefined && http >= 400 && http < 500 && http !== 429 && http !== 408) return true;
    return false;
  }

  private async atomicTransition(
    paymentId: string,
    to: PaymentStatus,
    patch: Partial<Payment>,
  ): Promise<void> {
    const ok = await this.payments.atomicUpdateStatus(paymentId, PaymentStatus.PROCESSING, {
      ...patch,
      status: to,
    });
    if (!ok) {
      throw new BadRequestException(
        `Cannot transition payment ${paymentId} to ${to}: status no longer processing (concurrent execution)`,
      );
    }
  }

  private attachAuditCallback(traceId: string, idempotencyKey: string): void {
    const observable = this.gateway as unknown as Partial<AttemptObservable>;
    if (typeof observable.setOnAttempt !== 'function') return;
    observable.setOnAttempt(async (ctx: GatewayAttemptContext) => {
      const input: RecordAttemptInput = {
        paymentId: ctx.paymentId,
        attemptNumber: ctx.attemptNumber,
        outcome: this.classifyOutcome(ctx.result, ctx.breakerState),
        httpStatus: ctx.result.httpStatus ?? null,
        errorCode: ctx.result.errorCode ?? null,
        errorMessage: ctx.result.errorMessage ?? null,
        delayBeforeNextMs: ctx.result.retryAfterMs ?? null,
        breakerState: (ctx.breakerState ?? 'closed').toLowerCase() as 'closed' | 'open' | 'half_open',
        durationMs: ctx.finishedAt.getTime() - ctx.startedAt.getTime(),
        traceId,
        idempotencyKey,
        gatewayReference: ctx.result.gatewayReference ?? null,
        replayed: ctx.result.replayed,
      };
      try {
        await this.audit.recordAttempt(input);
      } catch (err) {
        this.logger.error({ err, paymentId: ctx.paymentId, attemptNumber: ctx.attemptNumber }, 'audit.recordAttempt failed');
      }
    });
  }

  private classifyOutcome(result: ChargeResult, breakerState?: string): AttemptOutcome {
    if (result.status === 'succeeded') return AttemptOutcome.SUCCESS;
    if (breakerState === 'open' || result.errorCode === 'circuit_open') return AttemptOutcome.CIRCUIT_OPEN;
    if (this.isPermanentFailure(result)) return AttemptOutcome.PERMANENT_FAILURE;
    if (result.errorCode === 'ETIMEDOUT' || result.errorCode === 'ECONNABORTED') return AttemptOutcome.TIMEOUT;
    return AttemptOutcome.RETRYABLE_FAILURE;
  }

  private formatAmount(amount: number): string {
    return amount.toFixed(2);
  }

  private toView(p: Payment): PaymentView {
    return {
      id: p.id,
      orderId: p.orderId,
      amount: p.amount,
      currency: p.currency,
      status: p.status,
      gatewayReference: p.gatewayReference,
      attemptCount: p.attemptCount,
      totalRetryCount: p.totalRetryCount,
      nextRetryAt: p.nextRetryAt,
      failureReason: p.failureReason,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };
  }
}
