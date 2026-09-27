// WAJIB: import otel.ts pertama - sebelum apapun yang load modules
// agar auto-instrumentations hook terpasang sebelum module system load.
// otel.ts akan cek IS_OTEL + NODE_ENV — sandbox (IS_OTEL=false) skip init.
import './otel';

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { Logger as PinoLogger } from 'nestjs-pino';
import cookieParser from 'cookie-parser';

import { AppModule } from './app.module';

/**
 * Bootstrap validation — reject insecure config in production (AUTH-17 §6).
 *
 * Per plan2 §14.6:
 *   - AUTH_MODE=mock + NODE_ENV=production → reject (mock is dev only)
 *   - AUTH_MODE=disabled + NODE_ENV=production → reject (disabled is dev/test only)
 *   - SESSION_STORE=memory + NODE_ENV=production → reject (no multi-instance)
 *
 * Per plan2 §9.4:
 *   - SESSION_STORE=redis + no REDIS_URL → reject (Redis required)
 */
function validateConfig(): void {
  const { NODE_ENV, AUTH_MODE, SESSION_STORE, REDIS_URL } = process.env;

  if (NODE_ENV === 'production') {
    if (AUTH_MODE === 'mock') {
      throw new Error(
        'AUTH_MODE=mock tidak boleh di production — pakai AUTH_MODE=oauth',
      );
    }
    if (AUTH_MODE === 'disabled') {
      throw new Error(
        'AUTH_MODE=disabled tidak boleh di production — pakai AUTH_MODE=oauth',
      );
    }
    if (SESSION_STORE === 'memory') {
      throw new Error(
        'SESSION_STORE=memory tidak boleh di production — pakai SESSION_STORE=redis',
      );
    }
  }

  if (SESSION_STORE === 'redis' && !REDIS_URL) {
    throw new Error(
      'REDIS_URL wajib diisi kalau SESSION_STORE=redis',
    );
  }
}

async function bootstrap() {
  // Validate config before app creation (fail fast)
  validateConfig();

  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  app.useLogger(app.get(PinoLogger));

  const config = app.get(ConfigService);
  const port = Number(process.env.PORT ?? config.get<number>('PORT') ?? 3001);
  const logger = new Logger('bootstrap');

  // cookie-parser middleware — parse `req.cookies` for session + CSRF
  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // CORS — allow frontend origin + credentials for cookie-based session
  app.enableCors({
    origin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Payment API')
    .setDescription('Cockatiel-based payment retry/failure scenario')
    .setVersion('0.1.0')
    .addServer(`http://localhost:${port}`)
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  await app.listen(port);
  logger.log(`payment-api listening on :${port}`);
  logger.log(`Swagger docs: http://localhost:${port}/docs`);
  logger.log(`AUTH_MODE=${process.env.AUTH_MODE ?? 'disabled'}`);
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed', err);
  process.exit(1);
});
