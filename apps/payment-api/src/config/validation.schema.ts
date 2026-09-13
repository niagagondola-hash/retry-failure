import * as Joi from 'joi';

/**
 * Validation schema for environment variables (plan section 15).
 * Bila env wajib missing saat start, NestJS akan throw error jelas.
 */
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // Payment API
  PORT: Joi.number().port().default(3001),
  GATEWAY_URL: Joi.string().uri().default('http://localhost:3002'),
  GATEWAY_TIMEOUT_MS: Joi.number().integer().positive().default(2000),

  // Cockatiel retry policy
  RETRY_MAX_ATTEMPTS: Joi.number().integer().positive().default(3),
  RETRY_BASE_DELAY_MS: Joi.number().integer().positive().default(500),
  RETRY_MAX_DELAY_MS: Joi.number().integer().positive().default(8000),
  RETRY_JITTER_RATIO: Joi.number().min(0).max(1).default(0.1),

  // Durable retry
  MAX_TOTAL_RETRIES: Joi.number().integer().positive().default(5),

  // Circuit breaker
  BREAKER_FAILURE_THRESHOLD: Joi.number().integer().positive().default(3),
  BREAKER_COOLDOWN_MS: Joi.number().integer().positive().default(10000),

  // Scheduler
  SCHEDULER_INTERVAL_MS: Joi.number().integer().positive().default(5000),

  // PostgreSQL
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().port().default(5432),
  DB_USER: Joi.string().default('retry_failure'),
  DB_PASS: Joi.string().allow('').default('retry_failure'),
  DB_NAME: Joi.string().default('retry_failure'),
  DB_SCHEMA: Joi.string().default('public'),

  // Observability
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().default('http://localhost:4318'),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info'),
});
