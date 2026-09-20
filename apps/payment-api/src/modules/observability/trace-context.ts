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
interface OtelSpan {
  recordException(err: Error): void;
  setStatus(status: { code: number; message?: string }): void;
  end(): void;
}

interface OtelApi {
  trace: {
    getSpan(ctx: unknown): { spanContext(): { traceId: string } } | undefined;
    getTracer(name: string): {
      startSpan(name: string, opts?: { attributes?: Record<string, unknown> }): OtelSpan;
    };
    setSpan(ctx: unknown, span: OtelSpan): unknown;
    SpanStatusCode: { ERROR: number; OK: number; UNSET: number };
  };
  context: {
    active(): unknown;
    with<T>(ctx: unknown, fn: () => Promise<T> | T): Promise<T> | T;
  };
}

let otelApi: OtelApi | null = null;
if (IS_OTEL) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const api = require('@opentelemetry/api');
    otelApi = { trace: api.trace, context: api.context };
  } catch {
    // @opentelemetry/api tidak ter-install
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

/**
 * Wrap fn dengan custom OTel span — kondisional IS_OTEL.
 *
 * IS_OTEL=false (sandbox default): just call fn() tanpa span creation.
 *   Tidak ada overhead OTel API call. Behavior sama dengan TASK-11 simplified.
 *
 * IS_OTEL=true (local Docker + Jaeger): create span + wrap fn dengan
 *   otelApi.context.with(trace.setSpan(...), fn). Span attributes di-set,
 *   exception di-record kalau error, span.end() di finally.
 *
 * Usage di payments.service.ts:
 *   return withOtelSpan('payment.processing', { 'payment.id': paymentId, ... }, async () => {
 *     // existing executePayment body (gateway.charge + applyOutcome)
 *   });
 */
export async function withOtelSpan<T>(
  name: string,
  attributes: Record<string, string | number>,
  fn: () => Promise<T>,
): Promise<T> {
  // IS_OTEL=false: just run fn tanpa span (no overhead)
  if (!otelApi) {
    return fn();
  }

  // IS_OTEL=true: create span + wrap fn
  const tracer = otelApi.trace.getTracer('payment-api');
  const span = tracer.startSpan(name, { attributes });

  try {
    const result = await otelApi.context.with(
      otelApi.trace.setSpan(otelApi.context.active(), span),
      fn,
    );
    return result;
  } catch (err) {
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    span.setStatus({
      code: otelApi.trace.SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  } finally {
    span.end();
  }
}
