import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    logger: ['log', 'error', 'warn', 'debug'],
  });
  const config = app.get(ConfigService);
  const port = Number(process.env.PORT ?? config.get<number>('PORT') ?? 3001);
  const logger = new Logger('bootstrap');

  // Global validation pipe (class-validator)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  // CORS: allow Next.js + Vue frontends
  app.enableCors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      // Allow same-origin, no-origin (curl), and known frontends
      const allowed: Array<string | undefined> = [
        undefined,
        null as unknown as string,
        'http://localhost:3000',
        'http://localhost:5173',
      ];
      if (allowed.includes(origin)) {
        cb(null, true);
      } else {
        cb(null, true); // permissive for demo
      }
    },
    credentials: true,
  });

  // Swagger
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
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed', err);
  process.exit(1);
});
