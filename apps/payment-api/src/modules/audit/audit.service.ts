import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentAttempt } from '../../database/entities/payment-attempt.entity';
import { Payment } from '../../database/entities/payment.entity';
import { PaymentRepository } from '../../database/repositories/payment.repository';
import { getTraceId } from '../observability/trace-context';
import {
  type AuditPort,
  type AttemptView,
  type RecordAttemptInput,
} from '../payments/audit/audit-port';

@Injectable()
export class AuditService implements AuditPort {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(PaymentAttempt)
    private readonly attemptRepo: Repository<PaymentAttempt>,
    private readonly payments: PaymentRepository,
  ) {}

  async recordAttempt(input: RecordAttemptInput): Promise<void> {
    try {
      const row = this.attemptRepo.create({
        paymentId: input.paymentId,
        attemptNumber: input.attemptNumber,
        outcome: input.outcome,
        httpStatus: input.httpStatus ?? null,
        errorCode: input.errorCode ?? null,
        errorMessage: input.errorMessage ?? null,
        delayBeforeNextMs: input.delayBeforeNextMs ?? null,
        breakerState: input.breakerState,
        durationMs: input.durationMs,
        traceId: input.traceId ?? getTraceId() ?? null,
        idempotencyKey: input.idempotencyKey,
        gatewayReference: input.gatewayReference ?? null,
        replayed: input.replayed,
      });
      await this.attemptRepo.save(row);

      await this.attemptRepo.manager
        .createQueryBuilder()
        .update(Payment)
        .set({ attemptCount: () => 'attempt_count + 1' })
        .where('id = :id', { id: input.paymentId })
        .execute();
    } catch (err) {
      this.logger.error(
        {
          err,
          paymentId: input.paymentId,
          attemptNumber: input.attemptNumber,
          outcome: input.outcome,
        },
        'AuditService.recordAttempt failed — swallowing to preserve payment flow',
      );
    }
  }

  async listAttempts(paymentId: string): Promise<AttemptView[]> {
    const rows = await this.attemptRepo.find({
      where: { paymentId },
      order: { attemptNumber: 'ASC' },
    });
    return rows.map((r) => this.toView(r));
  }

  private toView(r: PaymentAttempt): AttemptView {
    return {
      id: r.id,
      paymentId: r.paymentId,
      attemptNumber: r.attemptNumber,
      outcome: r.outcome,
      httpStatus: r.httpStatus,
      errorCode: r.errorCode,
      errorMessage: r.errorMessage,
      delayBeforeNextMs: r.delayBeforeNextMs,
      breakerState: r.breakerState,
      durationMs: r.durationMs,
      traceId: r.traceId,
      idempotencyKey: r.idempotencyKey,
      gatewayReference: r.gatewayReference,
      replayed: r.replayed,
      createdAt: r.createdAt,
    };
  }
}
