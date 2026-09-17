/**
 * Trace context via AsyncLocalStorage with IS_OTEL feature flag.
 *
 * IS_OTEL=false (default): trace ID from crypto.randomUUID() via AsyncLocalStorage.
 * IS_OTEL=true: trace ID from OTel active span (bila SDK aktif via TASK-11b),
 *   fallback ke AsyncLocalStorage bila OTel SDK tidak di-load.
 *
 * Safe toggle: bila IS_OTEL=true TAPI TASK-11b belum dieksekusi (tidak ada
 * @opentelemetry/api), require() gagal -> catch -> fallback ALS. Tidak crash.
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface TraceContext {
  traceId: string;
  paymentId?: string;
  source?: 'api' | 'scheduler' | 'manual';
}

const als = new AsyncLocalStorage<TraceContext>();

const IS_OTEL = process.env.IS_OTEL === 'true';

// Pre-load @opentelemetry/api bila IS_OTEL=true (CJS require - synchronous)
interface OtelApi {
  trace: {
    getSpan(ctx: unknown): { spanContext(): { traceId: string } } | undefined;
  };
  context: {
    active(): unknown;
  };
}

let otelApi: OtelApi | null = null;
if (IS_OTEL) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require('@opentelemetry/api');
    otelApi = { trace: api.trace, context: api.context };
  } catch {
    // @opentelemetry/api tidak ter-install (TASK-11b belum dieksekusi)
  }
}

export function withTrace<T>(
  fn: () => Promise<T> | T,
  opts: { traceId?: string; paymentId?: string; source?: TraceContext['source'] } = {},
): Promise<T> | T {
  const existing = als.getStore();
  if (existing) {
    return fn();
  }

  let traceId = opts.traceId;
  if (!traceId && otelApi) {
    const span = otelApi.trace.getSpan(otelApi.context.active());
    if (span) {
      traceId = span.spanContext().traceId;
    }
  }

  const ctx: TraceContext = {
    traceId: traceId ?? randomUUID(),
    paymentId: opts.paymentId,
    source: opts.source,
  };
  return als.run(ctx, fn);
}

export function getTraceId(): string | undefined {
  if (otelApi) {
    const span = otelApi.trace.getSpan(otelApi.context.active());
    if (span) {
      const traceId = span.spanContext().traceId;
      if (traceId) return traceId;
    }
  }
  return als.getStore()?.traceId;
}

export function getTraceIdSync(): string | undefined {
  return getTraceId();
}

export function getTraceContext(): TraceContext | undefined {
  return als.getStore();
}

export function setTracePaymentId(paymentId: string): void {
  const store = als.getStore();
  if (store) {
    store.paymentId = paymentId;
  }
}
