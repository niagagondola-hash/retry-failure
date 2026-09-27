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
 * Tanpa loadEnv() di sini, process.env.IS_OTEL akan undefined saat
 * otel.ts di-evaluate.
 *
 * Env loading: via loadEnv() helper (adaptive — monorepo root OR per-app
 * OR OS env vars). Lihat `config/env-loader.ts` untuk details.
 * DRY: tidak duplicate env path logic — reuse loadEnv().
 */

import { loadEnv } from './config/env-loader';

// Load env SEBELUM evaluate IS_OTEL.
// Adaptive: monorepo root .env (dev) OR per-app .env (Docker) OR OS env (k8s).
loadEnv();

// Gate by IS_OTEL + NODE_ENV — supaya sandbox (no Jaeger) tidak spam ECONNREFUSED
const IS_OTEL = process.env.IS_OTEL === 'true';
const isTestEnv = process.env.NODE_ENV === 'test';

if (IS_OTEL && !isTestEnv) {
  // Lazy require supaya kalau IS_OTEL=false, OTel SDK tidak di-load (reduce startup time)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { NodeSDK } = require('@opentelemetry/sdk-node') as typeof import('@opentelemetry/sdk-node');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http') as typeof import('@opentelemetry/exporter-trace-otlp-http');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resourceFromAttributes } = require('@opentelemetry/resources') as typeof import('@opentelemetry/resources');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const semanticConventions = require('@opentelemetry/semantic-conventions') as typeof import('@opentelemetry/semantic-conventions');
  const { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } = semanticConventions;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node') as typeof import('@opentelemetry/auto-instrumentations-node');

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
