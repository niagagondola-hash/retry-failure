/**
 * Strongly-typed configuration accessor.
 * Usage: `const cfg = app.get(ConfigService); cfg.get<string>('GATEWAY_URL')`.
 *
 * This file provides a typed view over env variables validated by validation.schema.ts.
 */
export interface AppConfig {
  nodeEnv: string;
  port: number;
  gatewayUrl: string;
  gatewayTimeoutMs: number;

  retryMaxAttempts: number;
  retryBaseDelayMs: number;
  retryMaxDelayMs: number;
  retryJitterRatio: number;

  maxTotalRetries: number;

  breakerFailureThreshold: number;
  breakerCooldownMs: number;

  schedulerIntervalMs: number;

  dbHost: string;
  dbPort: number;
  dbUser: string;
  dbPass: string;
  dbName: string;
  dbSchema: string;

  otelEndpoint: string;
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    nodeEnv: env.NODE_ENV ?? 'development',
    port: Number(env.PORT ?? 3001),
    gatewayUrl: env.GATEWAY_URL ?? 'http://localhost:3002',
    gatewayTimeoutMs: Number(env.GATEWAY_TIMEOUT_MS ?? 2000),

    retryMaxAttempts: Number(env.RETRY_MAX_ATTEMPTS ?? 3),
    retryBaseDelayMs: Number(env.RETRY_BASE_DELAY_MS ?? 500),
    retryMaxDelayMs: Number(env.RETRY_MAX_DELAY_MS ?? 8000),
    retryJitterRatio: Number(env.RETRY_JITTER_RATIO ?? 0.1),

    maxTotalRetries: Number(env.MAX_TOTAL_RETRIES ?? 5),

    breakerFailureThreshold: Number(env.BREAKER_FAILURE_THRESHOLD ?? 3),
    breakerCooldownMs: Number(env.BREAKER_COOLDOWN_MS ?? 10000),

    schedulerIntervalMs: Number(env.SCHEDULER_INTERVAL_MS ?? 5000),

    dbHost: env.DB_HOST ?? 'localhost',
    dbPort: Number(env.DB_PORT ?? 5432),
    dbUser: env.DB_USER ?? 'retry_failure',
    dbPass: env.DB_PASS ?? 'retry_failure',
    dbName: env.DB_NAME ?? 'retry_failure',
    dbSchema: env.DB_SCHEMA ?? 'public',

    otelEndpoint: env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318',
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
