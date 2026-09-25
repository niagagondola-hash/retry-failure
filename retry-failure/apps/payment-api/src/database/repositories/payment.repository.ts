import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Payment, PaymentStatus } from '../entities';

/**
 * Repository for `payments` table (plan section 11.1).
 *
 * Provides CRUD + atomic state transitions + due-retry query for scheduler.
 */
@Injectable()
export class PaymentRepository {
  constructor(
    @InjectRepository(Payment)
    private readonly repo: Repository<Payment>,
  ) {}

  async create(data: Partial<Payment>): Promise<Payment> {
    return this.repo.save(this.repo.create(data));
  }

  async findById(id: string): Promise<Payment | null> {
    return this.repo.findOne({ where: { id } });
  }

  async findByIdWithAttempts(id: string): Promise<Payment | null> {
    return this.repo.findOne({
      where: { id },
      relations: ['attempts'],
    });
  }

  async list(filter: { status?: PaymentStatus }, limit = 100): Promise<Payment[]> {
    return this.repo.find({
      where: filter,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /**
   * Find payments scheduled for retry whose next_retry_at <= now.
   * Used by durable retry scheduler (TASK-10).
   */
  async findDueRetries(now: Date, limit = 50): Promise<Payment[]> {
    return this.repo
      .createQueryBuilder('p')
      .where('p.status = :status', { status: PaymentStatus.SCHEDULED_FOR_RETRY })
      .andWhere('p.next_retry_at <= :now', { now })
      .orderBy('p.next_retry_at', 'ASC')
      .limit(limit)
      .getMany();
  }

  /**
   * Atomic state transition: only update if current status matches expectedFrom.
   * Returns true if update affected 1 row, false otherwise (race / wrong state).
   *
   * Use this to prevent overwrites when scheduler + manual retry compete.
   */
  async atomicUpdateStatus(
    id: string,
    expectedFrom: PaymentStatus,
    patch: Partial<Payment>,
  ): Promise<boolean> {
    const result = await this.repo.update({ id, status: expectedFrom }, patch);
    return (result.affected ?? 0) === 1;
  }

  /**
   * Increment attempt_count atomically (after audit record in TASK-08).
   */
  async incrementAttemptCount(id: string): Promise<void> {
    await this.repo.increment({ id }, 'attemptCount', 1);
  }

  /**
   * Increment total_retry_count atomically (after durable retry cycle).
   */
  async incrementTotalRetryCount(id: string): Promise<void> {
    await this.repo.increment({ id }, 'totalRetryCount', 1);
  }

  async save(payment: Payment): Promise<Payment> {
    return this.repo.save(payment);
  }
}
