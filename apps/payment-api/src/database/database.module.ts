import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { LoggerOptions } from 'typeorm';
import { Payment } from './entities/payment.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { buildDbConfig } from './db-config';
import { PaymentRepository } from './repositories/payment.repository';
import { PaymentAttemptRepository } from './repositories/payment-attempt.repository';

@Global()
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => {
        const dbType = cfg.get<string>('DB_TYPE') ?? 'postgres';        
        const logging: LoggerOptions =
          cfg.get<string>('LOG_LEVEL') === 'debug' ? 'all' : ['error', 'warn'];

        return buildDbConfig({
          dbType,
          logging,
          host: cfg.get<string>('DB_HOST'),
          port: cfg.get<number>('DB_PORT'),
          username: cfg.get<string>('DB_USER'),
          password: cfg.get<string>('DB_PASS'),
          database: cfg.get<string>('DB_NAME'),
          schema: cfg.get<string>('DB_SCHEMA'),
          sqliteStorage: cfg.get<string>('DB_SQLITE_PATH'),
        });
      },
    }),
    TypeOrmModule.forFeature([Payment, PaymentAttempt]),
  ],
  providers: [PaymentRepository, PaymentAttemptRepository],
  exports: [TypeOrmModule, PaymentRepository, PaymentAttemptRepository],
})
export class DatabaseModule {}