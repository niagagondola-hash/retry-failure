import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Payment } from '../../database/entities';
import { PaymentRepository } from '../../database/repositories/payment.repository';
import { GatewayModule } from '../gateway';
import { AuditModule } from '../audit';
import { ObservabilityModule } from '../observability';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment]),
    GatewayModule,
    AuditModule,
    ObservabilityModule,
  ],
  controllers: [PaymentsController],
  providers: [
    PaymentRepository,
    PaymentsService,
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
