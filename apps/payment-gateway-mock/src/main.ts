import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: '*' });

  const port = Number(process.env.PORT ?? 3002);
  const logger = new Logger('gateway-mock');
  await app.listen(port);
  logger.log(`payment-gateway-mock listening on :${port}`);
}

bootstrap().catch((err) => {
  console.error('Bootstrap failed', err);
  process.exit(1);
});
