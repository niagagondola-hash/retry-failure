import { Module } from '@nestjs/common';
import { ConfigAppModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { GatewayModule } from './modules/gateway/gateway.module';
import { PaymentsModule } from './modules/payments/payments.module';

@Module({
  imports: [ConfigAppModule, DatabaseModule, GatewayModule, PaymentsModule],
})
export class AppModule {}
