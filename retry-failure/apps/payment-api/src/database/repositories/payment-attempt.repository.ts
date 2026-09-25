import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PaymentAttempt } from '../entities';

/**
 * Repository for `payment_attempts` table (plan section 11.2).
 *
 * Audit trail: each Cockatiel attempt + scheduler cycle records 1 row here.
 */
@Injectable()
export class PaymentAttemptRepository {
  constructor(
    @InjectRepository(PaymentAttempt)
    private readonly repo: Repository<PaymentAttempt>,
  ) {}

  async create(data: Partial<PaymentAttempt>): Promise<PaymentAttempt> {
    return this.repo.save(this.repo.create(data));
  }

  async listByPaymentId(paymentId: string): Promise<PaymentAttempt[]> {
    return this.repo.find({
      where: { paymentId },
      order: { attemptNumber: 'ASC' },
    });
  }

  async findByIdempotencyKey(key: string): Promise<PaymentAttempt[]> {
    return this.repo.find({
      where: { idempotencyKey: key },
      order: { createdAt: 'ASC' },
    });
  }

  async save(attempt: PaymentAttempt): Promise<PaymentAttempt> {
    return this.repo.save(attempt);
  }

  async deleteByPaymentId(paymentId: string): Promise<void> {
    await this.repo.delete({ paymentId });
  }
}
