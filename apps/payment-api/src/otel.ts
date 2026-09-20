/**
 * OpenTelemetry SDK initialization - WAJIB di-import pertama di main.ts
 * SEBELUM NestFactory.create(), agar auto-instrumentations hook terpasang
 * sebelum module system load.
 *
 * Production: export ke OTLP collector (Jaeger all-in-one port 4318).
 * Test: skip init (NODE_ENV=test -> return early, tidak start SDK).
 * Sandbox (no Docker, IS_OTEL=false default): SDK tidak start, fallback ALS.
 *
 * Task reference: docs/tasks/TASK-11b-otel-sdk.md
 *
 * IMPORTANT: env file (.env) harus di-load DI SINI sebelum evaluate IS_OTEL,
 * karena otel.ts di-import SEBELUM NestJS ConfigModule load .env file.
 * Tanpa dotenv.config() di sini, process.env.IS_OTEL akan undefined saat
 * otel.ts di-evaluate (lihat bug report: otel.ts baca undefined, trace-context.ts
 * baca 'true' karena trace-context di-import via AppModule setelah ConfigModule jalan).
 */

import { resolve } from 'node:path';
// dotenv sudah ter-install sebagai transitive dep dari @nestjs/config
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dotenv = require('dotenv');

// Load .env files SEBELUM evaluate IS_OTEL.
// Path: relative ke __dirname (dist/otel.js → parent = apps/payment-api/ → .env ada di sini).
// Fallback: process.cwd() kalau di-start dari root monorepo.
const envPaths = [
  resolve(__dirname, '..', '.env'),        // dist/ → apps/payment-api/.env (normal case)
  resolve(__dirname, '..', '.env.local'),  // dist/ → apps/payment-api/.env.local (override)
  resolve(process.cwd(), '.env'),          // CWD/.env (fallback kalau start dari root)
  resolve(process.cwd(), 'apps', 'payment-api', '.env'),  // root/apps/payment-api/.env
];
for (const p of envPaths) {
  dotenv.config({ path: p });
}

// Gate by IS_OTEL + NODE_ENV — supaya sandbox (no Jaeger) tidak spam ECONNREFUSED
const IS_OTEL = process.env.IS_OTEL === 'true';
const isTestEnv = process.env.NODE_ENV === 'test';

if (IS_OTEL && !isTestEnv) {
  // Lazy require supaya kalau IS_OTEL=false, OTel SDK tidak di-load (reduce startup time)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NodeSDK } = require('@opentelemetry/sdk-node');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

  const exporterUrl =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318/v1/traces';

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]: 'payment-api',
      [SEMRESATTRS_SERVICE_VERSION]: '0.1.0',
    }),
    traceExporter: new OTLPTraceExporter({ url: exporterUrl }),
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable instrumentations yang tidak perlu (reduce overhead)
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();

  // Graceful shutdown - flush pending spans ke Jaeger sebelum process exit
  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
