import { Module, Global } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Payment } from './entities/payment.entity';
import { PaymentAttempt } from './entities/payment-attempt.entity';
import { PaymentRepository } from './repositories/payment.repository';
import { PaymentAttemptRepository } from './repositories/payment-attempt.repository';

/**
 * Global TypeORM module — exposes DB connection + custom repositories app-wide.
 *
 * `synchronize: false` WAJIB. Jangan pernah true di production.
 * Migrations di-handle via TypeORM CLI (`pnpm db:migrate`).
 */
@Global()
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        type: 'postgres' as const,
        host: cfg.get<string>('DB_HOST') ?? 'localhost',
        port: cfg.get<number>('DB_PORT') ?? 5432,
        username: cfg.get<string>('DB_USER') ?? 'retry_failure',
        password: cfg.get<string>('DB_PASS') ?? 'retry_failure',
        database: cfg.get<string>('DB_NAME') ?? 'retry_failure',
        schema: cfg.get<string>('DB_SCHEMA') ?? 'public',
        entities: [Payment, PaymentAttempt],
        synchronize: false,
        logging: cfg.get<string>('LOG_LEVEL') === 'debug' ? 'all' : ['error', 'warn'],
      }),
    }),
    TypeOrmModule.forFeature([Payment, PaymentAttempt]),
  ],
  providers: [PaymentRepository, PaymentAttemptRepository],
  exports: [TypeOrmModule, PaymentRepository, PaymentAttemptRepository],
})
export class DatabaseModule {}
