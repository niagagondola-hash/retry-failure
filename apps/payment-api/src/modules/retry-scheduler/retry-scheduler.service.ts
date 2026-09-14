import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { PaymentsService } from '../payments/payments.service';
import { PaymentRepository } from '../../database/repositories/payment.repository';
import type { Payment } from '../../database/entities/payment.entity';

const DEFAULT_INTERVAL_MS = 5000;
const INTERVAL_NAME = 'retry-scheduler-poll';

@Injectable()
export class RetrySchedulerService implements OnApplicationBootstrap {
  private readonly logger = new Logger(RetrySchedulerService.name);
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly maxTotalRetries: number;

  private lastPollAt: Date | null = null;
  private processedCount = 0;
  private errorCount = 0;
  private lastError: string | null = null;
  private running = false;

  constructor(
    private readonly paymentsService: PaymentsService,
    private readonly payments: PaymentRepository,
    private readonly config: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
  ) {
    this.intervalMs = this.config.get<number>('SCHEDULER_INTERVAL_MS') ?? DEFAULT_INTERVAL_MS;
    this.batchSize = this.config.get<number>('SCHEDULER_BATCH_SIZE') ?? 50;
    this.maxTotalRetries = this.config.get<number>('MAX_TOTAL_RETRIES') ?? 5;
  }

  async onApplicationBootstrap(): Promise<void> {
    try {
      this.schedulerRegistry.deleteInterval(INTERVAL_NAME);
    } catch {
      // Interval tidak ada — normal first run
    }

    const intervalRef = setInterval(() => {
      void this.poll().catch((err: unknown) => {
        this.logger.error({ err }, '[scheduler] poll crashed (uncaught)');
        this.errorCount += 1;
        this.lastError = err instanceof Error ? err.message : String(err);
      });
    }, this.intervalMs);
    this.schedulerRegistry.addInterval(INTERVAL_NAME, intervalRef);

    this.logger.log(
      `Scheduler started: intervalMs=${this.intervalMs}, batchSize=${this.batchSize}, maxTotalRetries=${this.maxTotalRetries}`,
    );
  }

  async poll(): Promise<void> {
    if (this.running) {
      this.logger.debug('Poll already running — skip cycle');
      return;
    }
    this.running = true;
    this.lastPollAt = new Date();

    try {
      const due = await this.payments.findDueRetries(new Date(), this.batchSize);

      if (due.length === 0) {
        this.logger.debug('No due payments — idle');
        return;
      }

      this.logger.log(`[scheduler] picked ${due.length} payment(s) due for retry`);

      for (const payment of due) {
        await this.processOne(payment);
      }
    } catch (err) {
      this.errorCount += 1;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.logger.error({ err }, '[scheduler] poll failed at query stage');
    } finally {
      this.running = false;
    }
  }

  private async processOne(payment: Payment): Promise<void> {
    const paymentId = payment.id;
    const totalRetryCount = payment.totalRetryCount;

    try {
      this.logger.log(
        { paymentId, totalRetryCount, nextRetryAt: payment.nextRetryAt },
        '[scheduler] picked paymentId',
      );

      const updated = await this.paymentsService.executePayment(paymentId, {
        source: 'scheduler',
      });

      this.processedCount += 1;

      if (
        updated.totalRetryCount >= this.maxTotalRetries - 1 &&
        updated.status === 'scheduled_for_retry'
      ) {
        this.logger.warn(
          { paymentId, totalRetryCount: updated.totalRetryCount, max: this.maxTotalRetries },
          '[scheduler] payment approaching MAX_TOTAL_RETRIES — next failure will mark as failed',
        );
      }

      this.logger.log(
        { paymentId, newStatus: updated.status, totalRetryCount: updated.totalRetryCount },
        `[scheduler] processed, result: status=${updated.status}`,
      );
    } catch (err) {
      this.errorCount += 1;
      this.lastError = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        { paymentId, err: this.lastError },
        '[scheduler] error processing payment — continue to next',
      );
    }
  }

  getStats(): {
    status: 'running' | 'idle';
    lastPollAt: Date | null;
    processedCount: number;
    errorCount: number;
    lastError: string | null;
    intervalMs: number;
    batchSize: number;
    maxTotalRetries: number;
  } {
    return {
      status: this.running ? 'running' : 'idle',
      lastPollAt: this.lastPollAt,
      processedCount: this.processedCount,
      errorCount: this.errorCount,
      lastError: this.lastError,
      intervalMs: this.intervalMs,
      batchSize: this.batchSize,
      maxTotalRetries: this.maxTotalRetries,
    };
  }
}
