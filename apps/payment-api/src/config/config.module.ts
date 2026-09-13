import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validationSchema } from './validation.schema';

/**
 * Global config module — exposes ConfigService app-wide.
 */
@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '.env.local'],
      validationSchema,
      validationOptions: {
        abortEarly: false,
        allowUnknown: true,
      },
    }),
  ],
  exports: [ConfigModule],
})
export class ConfigAppModule {}
