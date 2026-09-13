import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PaymentAttempt } from '../../database/entities/payment-attempt.entity';
import { PaymentRepository } from '../../database/repositories/payment.repository';
import { AUDIT_PORT } from '../payments/audit/audit-port';
import { AuditService } from './audit.service';

@Module({
  imports: [TypeOrmModule.forFeature([PaymentAttempt])],
  providers: [
    AuditService,
    PaymentRepository,
    { provide: AUDIT_PORT, useExisting: AuditService },
  ],
  exports: [AUDIT_PORT, AuditService],
})
export class AuditModule {}
