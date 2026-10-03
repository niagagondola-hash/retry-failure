import { join } from 'node:path';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { loadEnv } from './env-loader';
import { FileLoggerService } from './file-logger.service';

// Load .env from monorepo root BEFORE any other module reads process.env.
// Must be called before AppModule imports (token-factory reads
// ACCESS_TOKEN_TTL, discovery reads AUTH_ISSUER, etc.).
loadEnv();

async function bootstrap() {
  // FileLoggerService writes to stdout + apps/logs/auth-mock-yyyyMMdd-HHmmss.log.
  // Instantiate BEFORE NestFactory.create + pass via `logger` option so it's
  // installed as the global logger BEFORE any Nest internal log fires during
  // module init. (Calling `app.useLogger()` after create() misses the bootstrap
  // log lines from RoutesResolver + InstanceLoader.)
  const fileLogger = new FileLoggerService();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: fileLogger,
  });

  // Static assets (CSS, JS, images) — /style.css, etc.
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // Views directory (EJS templates) — login.ejs, select-role.ejs, error.ejs
  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  app.setViewEngine('ejs');

  // cookie-parser (akan dipakai untuk auth_sid session)
  const cookieParser = await import('cookie-parser');
  app.use(cookieParser.default());

  app.enableCors({ origin: '*' });

  const port = Number(process.env.AUTH_MOCK_PORT ?? 4001);
  await app.listen(port);

  // Bootstrap log via the global file-aware logger (writes to stdout + file).
  const logger = new Logger('AuthMock');
  logger.log(`auth-mock listening on http://localhost:${port}`);
  logger.log('⚠️  Development only — do NOT use in production.');
}

bootstrap();
