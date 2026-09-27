import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validationSchema } from './validation.schema';
import { loadEnv } from './env-loader';

/**
 * Global config module — exposes ConfigService app-wide.
 *
 * Env loading strategy (adaptive — supports 3 deploy scenarios):
 *   1. Dev/Sandbox: monorepo root `.env` (loadEnv handles path resolution)
 *   2. Standalone Docker: per-app `.env` di WORKDIR
 *   3. Production k8s: env vars dari OS (dotenv tidak override existing)
 *
 * `loadEnv()` called explicitly SEBELUM ConfigModule.forRoot() supaya
 * process.env sudah terisi saat NestJS bootstrap.
 *
 * `envFilePath` juga di-set supaya ConfigModule aware of file locations
 * (untuk ConfigService reload + hot-reload di dev mode).
 */
// Load env explicitly (adaptive — handles monorepo root, per-app, OS env)
loadEnv();

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // ConfigModule envFilePath — adaptive sama seperti loadEnv()
      // tapi ConfigModule tidak throw error kalau file tidak ada
      envFilePath: [
        // Strategy 1: monorepo root (dev sandbox)
        // apps/payment-api/dist/config/ → ../../../../ = retry-failure/
        // apps/payment-api/src/config/ → ../../../../ = retry-failure/
        // (di runtime, __dirname = dist/config/, jadi 4 level naik)
        '../../.env',
        '../../.env.local',
        // Strategy 2: per-app (standalone Docker, cwd = /app/)
        '.env',
        '.env.local',
      ],
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
