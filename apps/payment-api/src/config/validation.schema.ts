import * as Joi from 'joi';

/**
 * Validation schema for environment variables.
 *
 * Plan reference:
 *   - Plan 1 section 15 (payment-api env vars)
 *   - Plan 2 section 16 (auth integration env vars — added in AUTH-17)
 *
 * Bila env wajib missing saat start, NestJS akan throw error jelas.
 *
 * Conditional validation per AUTH_MODE:
 *   - oauth|mock → AUTH_BASE_URL, AUTH_ISSUER, OAUTH_CLIENT_SECRET, OAUTH_REDIRECT_URI required
 *   - disabled → AUTH_DISABLED_USER_ID, AUTH_DISABLED_USERNAME, AUTH_DISABLED_ROLE_ID required
 *
 * Conditional validation per SESSION_STORE:
 *   - redis → REDIS_URL required
 */
export const validationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),

  // ===== Payment API (Plan 1) =====
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

  // Scheduler base delay (ms)
  SCHEDULER_BASE_DELAY_MS: Joi.number().integer().positive().default(30000),

  // Circuit breaker
  BREAKER_FAILURE_THRESHOLD: Joi.number().integer().positive().default(3),
  BREAKER_COOLDOWN_MS: Joi.number().integer().positive().default(10000),

  // Scheduler
  SCHEDULER_INTERVAL_MS: Joi.number().integer().positive().default(5000),

  // ===== Database (Plan 1) =====
  DB_TYPE: Joi.string().valid('postgres', 'sqlite').default('postgres'),
  DB_HOST: Joi.string().default('localhost'),
  DB_PORT: Joi.number().port().default(5432),
  DB_USER: Joi.string().default('retry_failure'),
  DB_PASS: Joi.string().allow('').default('retry_failure'),
  DB_NAME: Joi.string().default('retry_failure'),
  DB_SCHEMA: Joi.string().default('public'),
  DB_SQLITE_PATH: Joi.string().default('./test.db'),

  // ===== Observability (Plan 1) =====
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().default('http://localhost:4318'),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace')
    .default('info'),

  // ===== Auth Integration (Plan 2 section 16) =====

  // AUTH_MODE — oauth (production) | mock (dev with auth-mock) | disabled (skip guards)
  AUTH_MODE: Joi.string().valid('oauth', 'mock', 'disabled').default('disabled'),

  // Required when AUTH_MODE = oauth | mock
  AUTH_BASE_URL: Joi.string().uri().when('AUTH_MODE', {
    is: Joi.valid('oauth', 'mock'),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  AUTH_ISSUER: Joi.string().when('AUTH_MODE', {
    is: Joi.valid('oauth', 'mock'),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  JWT_AUDIENCE: Joi.string().default('payment-api'),
  OAUTH_CLIENT_ID: Joi.string().default('payment-api'),
  OAUTH_CLIENT_SECRET: Joi.string().when('AUTH_MODE', {
    is: Joi.valid('oauth', 'mock'),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  OAUTH_REDIRECT_URI: Joi.string().uri().when('AUTH_MODE', {
    is: Joi.valid('oauth', 'mock'),
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  OAUTH_SCOPES: Joi.string().default('openid profile'),

  // Required when AUTH_MODE = disabled (fake user for dev/test)
  AUTH_DISABLED_USER_ID: Joi.string().uuid().when('AUTH_MODE', {
    is: 'disabled',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  AUTH_DISABLED_USERNAME: Joi.string().when('AUTH_MODE', {
    is: 'disabled',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  AUTH_DISABLED_ROLE_ID: Joi.string().uuid().when('AUTH_MODE', {
    is: 'disabled',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),
  AUTH_DISABLED_IS_SUPER_ADMIN: Joi.boolean().default(true),
  AUTH_DISABLED_PERMISSION_CODES: Joi.string().default('*'),

  // JWT verification (plan2 §5.3)
  JWT_CLOCK_TOLERANCE_SEC: Joi.number().integer().positive().default(5),
  JWKS_CACHE_TTL_SEC: Joi.number().integer().positive().default(300),

  // Session store (plan2 §9.4)
  SESSION_STORE: Joi.string()
    .valid('redis', 'memory')
    .default('memory'),
  SESSION_SECRET: Joi.string().min(32).required(),
  SESSION_TTL_SEC: Joi.number().integer().positive().default(28800),
  SESSION_COOKIE_NAME: Joi.string().default('sid'),
  SESSION_COOKIE_SAMESITE: Joi.string()
    .valid('Lax', 'None', 'Strict')
    .default('Lax'),
  SESSION_ENCRYPTION_KEY: Joi.string().optional(),

  // Lazy sync TTLs (plan2 §8.2)
  SYNC_FRESH_TTL_MS: Joi.number().integer().positive().default(300000),
  SYNC_STALE_TTL_MS: Joi.number().integer().positive().default(1800000),
  SYNC_MAX_STALE_TTL_MS: Joi.number().integer().positive().default(7200000),
  SYNC_BLOCKING_TIMEOUT_MS: Joi.number().integer().positive().default(2000),
  SYNC_LOCK_TTL_SEC: Joi.number().integer().positive().default(10),

  // CSRF (plan2 §12.3)
  CSRF_ENABLED: Joi.boolean().default(true),

  // CORS + rate limiting (plan2 §12.5, §16)
  CORS_ORIGIN: Joi.string().default('http://localhost:5173'),
  THROTTLE_TTL: Joi.number().integer().positive().default(60000),
  THROTTLE_LIMIT: Joi.number().integer().positive().default(100),
  THROTTLER_DISABLED: Joi.boolean().default(false),

  // Redis (required when SESSION_STORE=redis)
  REDIS_URL: Joi.string().when('SESSION_STORE', {
    is: 'redis',
    then: Joi.required(),
    otherwise: Joi.optional(),
  }),

  // FE only (not used by payment-api, but allowed)
  VITE_API_URL: Joi.string().optional(),
});
