/**
 * OpenTelemetry SDK initialization untuk gateway mock.
 *
 * WAJIB di-import pertama di main.ts sebelum NestFactory.create(),
 * agar auto-instrumentations hook terpasang sebelum module system load.
 *
 * Dengan instrument ini, trace context otomatis propagate dari payment-api
 * -> gateway mock via W3C `traceparent` header (di-inject oleh axios
 * auto-instrumentation di payment-api, di-receive oleh HTTP server
 * auto-instrumentation di gateway mock). Jaeger UI akan menampilkan
 * cross-service span tree.
 *
 * Test: skip init (NODE_ENV=test -> return early, tidak start SDK).
 * Sandbox (no Docker, IS_OTEL=false default): SDK tidak start.
 *
 * Task reference: docs/tasks/TASK-11b-otel-sdk.md (step 6)
 *
 * IMPORTANT: env file (.env) harus di-load DI SINI sebelum evaluate IS_OTEL,
 * karena otel.ts di-import SEBELUM NestJS ConfigModule load .env file.
 * Tanpa dotenv.config() di sini, process.env.IS_OTEL akan undefined saat
 * otel.ts di-evaluate (lihat bug report di payment-api/src/otel.ts).
 */

import { resolve } from 'node:path';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const dotenv = require('dotenv');

// Load .env files SEBELUM evaluate IS_OTEL.
// Path: relative ke __dirname (dist/otel.js → parent = apps/payment-gateway-mock/).
const envPaths = [
  resolve(__dirname, '..', '.env'),
  resolve(__dirname, '..', '.env.local'),
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), 'apps', 'payment-gateway-mock', '.env'),
];
for (const p of envPaths) {
  dotenv.config({ path: p });
}

const IS_OTEL = process.env.IS_OTEL === 'true';
const isTestEnv = process.env.NODE_ENV === 'test';

if (IS_OTEL && !isTestEnv) {
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
      [SEMRESATTRS_SERVICE_NAME]: 'payment-gateway-mock',
      [SEMRESATTRS_SERVICE_VERSION]: '0.1.0',
    }),
    traceExporter: new OTLPTraceExporter({ url: exporterUrl }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
        '@opentelemetry/instrumentation-dns': { enabled: false },
      }),
    ],
  });

  sdk.start();

  process.on('SIGTERM', () => {
    sdk
      .shutdown()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  });
}
