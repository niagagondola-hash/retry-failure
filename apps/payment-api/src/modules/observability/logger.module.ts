/**
 * LoggerModule — nestjs-pino setup with pino-pretty for dev.
 * Injects traceId via mixin (getTraceIdSync).
 */

import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ConfigService } from '@nestjs/config';
import { getTraceIdSync } from './trace-context';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) => ({
        pinoHttp: {
          level: cfg.get<string>('LOG_LEVEL') ?? 'info',
          mixin: () => {
            const traceId = getTraceIdSync();
            return traceId ? { traceId } : {};
          },
          autoLogging: {
            ignore: (req: { url?: string }) =>
              req.url === '/metrics' || req.url === '/health',
          },
          transport:
            cfg.get<string>('NODE_ENV') !== 'production'
              ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } }
              : undefined,
        },
      }),
    }),
  ],
  exports: [PinoLoggerModule],
})
export class AppLoggerModule {}
