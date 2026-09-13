import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../../database/entities';
import { PaymentRepository } from '../../database/repositories/payment.repository';
import { GatewayModule } from '../gateway';
import { PaymentsService } from './payments.service';
import { AUDIT_PORT, NoopAuditService } from './audit/audit-port';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment]),
    GatewayModule,
  ],
  providers: [
    PaymentRepository,
    PaymentsService,
    { provide: AUDIT_PORT, useClass: NoopAuditService },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
