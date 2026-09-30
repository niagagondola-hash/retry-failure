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

import { validateBootstrapConfig } from '@retry-failure/security';

import { AppModule } from './app.module';

async function bootstrap() {
  // Validate config before app creation (fail fast).
  // Validates: NODE_ENV=production + AUTH_MODE in {mock,disabled} → reject;
  // NODE_ENV=production + SESSION_STORE=memory → reject;
  // SESSION_STORE=redis + no REDIS_URL → reject (any NODE_ENV).
  // Implementation lives in packages/security/src/utils/bootstrap-validation.ts
  // so it can be unit-tested (see AUTH-24).
  validateBootstrapConfig(process.env);

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
