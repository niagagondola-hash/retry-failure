import { Module } from '@nestjs/common';
import { ConfigAppModule } from './config/config.module';
import { DatabaseModule } from './database/database.module';
import { GatewayModule } from './modules/gateway/gateway.module';

@Module({
  imports: [ConfigAppModule, DatabaseModule, GatewayModule],
})
export class AppModule {}
