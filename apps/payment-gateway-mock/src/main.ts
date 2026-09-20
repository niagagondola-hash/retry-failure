/**
 * Bootstrap for payment-gateway-mock (port 3002 in sandbox, 3001 in local).
 *
 * - Port: read from process.env.PORT (defaults to 3002 per SANDBOX_NOTES.md).
 * - CORS: origin '*' so the Vue frontend (port 5173) can call /admin/config
 *   directly. Next.js sandbox uses Caddy's ?XTransformPort proxy instead.
 * - ValidationPipe: global, whitelist (strip unknown props), transform
 *   (coerce JSON values to DTO types).
 */

// WAJIB: import otel.ts pertama - sebelum apapun yang load modules
// agar auto-instrumentations hook terpasang sebelum module system load.
// otel.ts akan cek IS_OTEL + NODE_ENV — sandbox (IS_OTEL=false) skip init.
import './otel';

import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableCors({ origin: '*' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const port = Number(process.env.PORT ?? 3002);
  const logger = new Logger('gateway-mock');
  await app.listen(port);
  logger.log(`payment-gateway-mock listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed', err);
  process.exit(1);
});
