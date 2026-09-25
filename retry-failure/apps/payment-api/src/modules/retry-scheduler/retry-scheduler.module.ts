import { Module } from '@nestjs/common';
import { RetrySchedulerService } from './retry-scheduler.service';
import { RetrySchedulerController } from './retry-scheduler.controller';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [RetrySchedulerController],
  providers: [RetrySchedulerService],
  exports: [RetrySchedulerService],
})
export class RetrySchedulerModule {}
