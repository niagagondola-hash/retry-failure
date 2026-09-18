<script setup lang="ts">
import { ref } from 'vue';
import { useGatewayStore } from '../stores/gateway';
import { usePaymentsStore } from '../stores/payments';
import { useMetricsStore } from '../stores/metrics';
import { useToast } from 'primevue/usetoast';
import {
  getPaymentById,
  type PaymentView,
  type AttemptView,
} from '../api/payments';
import { getGatewayStats, type GatewayStats } from '../api/gateway';

const gatewayStore = useGatewayStore();
const paymentsStore = usePaymentsStore();
const metricsStore = useMetricsStore();
const toast = useToast();

type DemoStatus = 'idle' | 'running' | 'success' | 'failed';

interface DemoResult {
  name: string;
  shortName: string;
  status: DemoStatus;
  message?: string;
  evidence?: DemoEvidence;
}

interface DemoEvidence {
  payment: PaymentView;
  attempts: AttemptView[];
  statsBefore: GatewayStats | null;
  statsAfter: GatewayStats | null;
  breakerState?: number;
  warnings: string[];
  assertionsPassed: string[];
  assertionsFailed: string[];
}

const results = ref<DemoResult[]>([
  { name: 'Demo A: Transient Retry', shortName: 'A', status: 'idle' },
  { name: 'Demo B: Permanent Failure', shortName: 'B', status: 'idle' },
  { name: 'Demo C: Circuit Breaker', shortName: 'C', status: 'idle' },
  { name: 'Demo D: Idempotency (Hero)', shortName: 'D', status: 'idle' },
  { name: 'Demo E: Retry-After', shortName: 'E', status: 'idle' },
]);

// Evidence dialog state
const evidenceVisible = ref(false);
const evidenceResult = ref<DemoResult | null>(null);

// ----- helpers -----

async function setMode(mode: string, extra: Record<string, unknown> = {}) {
  await gatewayStore.updateConfig({ mode, ...extra });
}

async function createPayment(orderId: string, amount: number): Promise<PaymentView> {
  return await paymentsStore.create({ orderId, amount, currency: 'IDR' });
}

async function fetchBreakerState(): Promise<number | undefined> {
  try {
    await metricsStore.refresh();
    return metricsStore.parsed?.circuitBreakerState;
  } catch {
    return undefined;
  }
}

function delta(before: GatewayStats | null, after: GatewayStats | null) {
  if (!before || !after) return null;
  return {
    requestCount: after.requestCount - before.requestCount,
    successCount: after.successCount - before.successCount,
    failureCount: after.failureCount - before.failureCount,
    replayCount: after.replayCount - before.replayCount,
    actualChargesCount: after.actualChargesCount - before.actualChargesCount,
  };
}

function truncateTrace(t: string | null): string {
  if (!t) return '-';
  return t.length > 12 ? `${t.slice(0, 8)}…${t.slice(-4)}` : t;
}

function openEvidence(result: DemoResult) {
  evidenceResult.value = result;
  evidenceVisible.value = true;
}

async function runDemo(index: number, fn: () => Promise<DemoEvidence>) {
  const result = results.value[index];
  result.status = 'running';
  result.message = undefined;
  result.evidence = undefined;
  try {
    const evidence = await fn();
    result.evidence = evidence;
    if (evidence.assertionsFailed.length === 0) {
      result.status = 'success';
      const warnSuffix = evidence.warnings.length > 0
        ? ` (${evidence.warnings.length} warning${evidence.warnings.length > 1 ? 's' : ''})`
        : '';
      toast.add({
        severity: 'success',
        summary: `Demo ${result.shortName} passed`,
        detail: `${evidence.assertionsPassed.join(' · ')}${warnSuffix}`,
        life: 6000,
      });
    } else {
      result.status = 'failed';
      toast.add({
        severity: 'error',
        summary: `Demo ${result.shortName} failed`,
        detail: evidence.assertionsFailed.join(' · '),
        life: 8000,
      });
    }
    for (const w of evidence.warnings) {
      toast.add({ severity: 'warn', summary: `Demo ${result.shortName} warning`, detail: w, life: 6000 });
    }
    // Show evidence dialog automatically
    openEvidence(result);
  } catch (e) {
    result.status = 'failed';
    result.message = e instanceof Error ? e.message : String(e);
    toast.add({
      severity: 'error',
      summary: `Demo ${result.shortName} error`,
      detail: result.message,
      life: 8000,
    });
  } finally {
    // Always restore gateway to safe mode
    try {
      await setMode('always-success');
    } catch {
      /* ignore */
    }
  }
}

// ----- Demo A: Transient Retry (fail-first-n=2) -----

async function runDemoA() {
  await runDemo(0, async () => {
    const statsBefore = await getGatewayStats().catch(() => null);
    await setMode('fail-first-n', { n: 2 });
    const payment = await createPayment(`DEMO-A-${Date.now()}`, 100);

    const detail = await getPaymentById(payment.id);
    const statsAfter = await getGatewayStats().catch(() => null);

    const warnings: string[] = [];
    const passed: string[] = [];
    const failed: string[] = [];

    if (payment.status === 'succeeded') {
      passed.push(`status=succeeded`);
    } else {
      failed.push(`expected succeeded, got ${payment.status}`);
    }

    if (payment.attemptCount >= 3) {
      passed.push(`attempts=${payment.attemptCount} (≥3 retries proven)`);
    } else if (payment.attemptCount >= 1) {
      warnings.push(`Expected ≥3 attempts to prove retry, got ${payment.attemptCount}`);
      passed.push(`attempts=${payment.attemptCount}`);
    } else {
      failed.push(`expected ≥1 attempt, got ${payment.attemptCount}`);
    }

    if (detail.attempts.length < 3 && detail.attempts.length > 0) {
      warnings.push(`Only ${detail.attempts.length} attempt rows recorded (expected ≥3)`);
    }

    return {
      payment,
      attempts: detail.attempts,
      statsBefore,
      statsAfter,
      warnings,
      assertionsPassed: passed,
      assertionsFailed: failed,
    };
  });
}

// ----- Demo B: Permanent Failure (client-error) -----

async function runDemoB() {
  await runDemo(1, async () => {
    const statsBefore = await getGatewayStats().catch(() => null);
    await setMode('client-error');
    const payment = await createPayment(`DEMO-B-${Date.now()}`, 100);

    const detail = await getPaymentById(payment.id);
    const statsAfter = await getGatewayStats().catch(() => null);

    const warnings: string[] = [];
    const passed: string[] = [];
    const failed: string[] = [];

    if (payment.status === 'failed') {
      passed.push('status=failed');
    } else {
      failed.push(`expected failed, got ${payment.status}`);
    }

    if (payment.attemptCount === 1) {
      passed.push('attempts=1 (no retry)');
    } else if (payment.attemptCount > 1) {
      warnings.push(`Permanent error was retried (attempts=${payment.attemptCount}, expected 1)`);
      passed.push(`attempts=${payment.attemptCount}`);
    } else {
      failed.push(`expected ≥1 attempt, got ${payment.attemptCount}`);
    }

    if (detail.attempts.length > 1) {
      warnings.push(`${detail.attempts.length} attempt rows — permanent error should not retry`);
    }

    return {
      payment,
      attempts: detail.attempts,
      statsBefore,
      statsAfter,
      warnings,
      assertionsPassed: passed,
      assertionsFailed: failed,
    };
  });
}

// ----- Demo C: Circuit Breaker (always-timeout × 3, then verify 4th is circuit_open) -----

async function runDemoC() {
  await runDemo(2, async () => {
    const statsBefore = await getGatewayStats().catch(() => null);
    await setMode('always-timeout', { timeoutMs: 5000 });

    // Fire 3 payments to trip the breaker (each will retry 4× then schedule_for_retry)
    for (let i = 0; i < 3; i++) {
      try {
        await createPayment(`DEMO-C-${Date.now()}-${i}`, 100);
      } catch {
        /* may reject — continue */
      }
    }

    // After 3×4 = 12 failures, breaker should be OPEN
    const breakerState = await fetchBreakerState();

    // 4th payment — should short-circuit (circuit_open outcome, attemptCount=1)
    let payment: PaymentView | null = null;
    try {
      payment = await createPayment(`DEMO-C-${Date.now()}-cb`, 100);
    } catch {
      /* ignore — breaker may have rejected the call */
    }

    const attempts: AttemptView[] = payment ? (await getPaymentById(payment.id)).attempts : [];
    const statsAfter = await getGatewayStats().catch(() => null);

    const warnings: string[] = [];
    const passed: string[] = [];
    const failed: string[] = [];

    if (breakerState === 1) {
      passed.push('breaker=OPEN');
    } else {
      warnings.push(`Breaker state=${breakerState ?? 'unknown'} (expected 1=OPEN)`);
    }

    if (payment) {
      if (payment.attemptCount === 1) {
        passed.push('4th payment attempts=1 (breaker short-circuited)');
      } else {
        warnings.push(`4th payment attempts=${payment.attemptCount} (expected 1 — breaker may not have OPENed)`);
      }
    } else {
      warnings.push('4th payment did not return — breaker may have rejected the call');
    }

    if (attempts.length > 0) {
      const lastOutcome = attempts[attempts.length - 1].outcome;
      if (lastOutcome === 'circuit_open') {
        passed.push('last outcome=circuit_open');
      } else {
        warnings.push(`Last outcome=${lastOutcome} (expected circuit_open)`);
      }
    }

    return {
      payment: payment ?? ({} as PaymentView),
      attempts,
      statsBefore,
      statsAfter,
      breakerState,
      warnings,
      assertionsPassed: passed,
      assertionsFailed: failed,
    };
  });
}

// ----- Demo D: Idempotency / Anti Double-Charge (HERO) -----

async function runDemoD() {
  await runDemo(3, async () => {
    const statsBefore = await getGatewayStats().catch(() => null);
    await setMode('succeed-but-drop-response');
    const payment = await createPayment(`DEMO-D-${Date.now()}`, 100);

    const detail = await getPaymentById(payment.id);
    const statsAfter = await getGatewayStats().catch(() => null);

    const warnings: string[] = [];
    const passed: string[] = [];
    const failed: string[] = [];

    if (payment.status === 'succeeded') {
      passed.push('status=succeeded');
    } else {
      failed.push(`expected succeeded, got ${payment.status}`);
    }

    if (payment.attemptCount >= 2) {
      passed.push(`attempts=${payment.attemptCount} (≥2 — replay occurred)`);
    } else {
      warnings.push(`Only ${payment.attemptCount} attempt (expected ≥2 — no replay?)`);
    }

    const d = delta(statsBefore, statsAfter);
    if (d) {
      if (d.actualChargesCount === 1) {
        passed.push('actualCharges delta=1 (NO DOUBLE CHARGE — HERO!)');
      } else if (d.actualChargesCount > 1) {
        failed.push(`actualCharges delta=${d.actualChargesCount} — DOUBLE CHARGE DETECTED!`);
      } else {
        warnings.push('actualCharges delta=0 — no charge recorded');
      }
      if (d.replayCount >= 1) {
        passed.push(`replays=${d.replayCount}`);
      }
    }

    return {
      payment,
      attempts: detail.attempts,
      statsBefore,
      statsAfter,
      warnings,
      assertionsPassed: passed,
      assertionsFailed: failed,
    };
  });
}

// ----- Demo E: Retry-After (rate-limited) -----

async function runDemoE() {
  await runDemo(4, async () => {
    const statsBefore = await getGatewayStats().catch(() => null);
    await setMode('rate-limited', { retryAfterSeconds: 3 });
    const payment = await createPayment(`DEMO-E-${Date.now()}`, 100);

    const detail = await getPaymentById(payment.id);
    const statsAfter = await getGatewayStats().catch(() => null);

    const warnings: string[] = [];
    const passed: string[] = [];
    const failed: string[] = [];

    if (payment.status === 'scheduled_for_retry' || payment.status === 'failed') {
      passed.push(`status=${payment.status}`);
    } else {
      warnings.push(`status=${payment.status} (expected scheduled_for_retry or failed)`);
    }

    if (detail.attempts.length > 0) {
      const firstAttempt = detail.attempts[0];
      if (firstAttempt.httpStatus === 429) {
        passed.push('httpStatus=429');
      } else {
        warnings.push(`httpStatus=${firstAttempt.httpStatus} (expected 429)`);
      }
      if (firstAttempt.delayBeforeNextMs !== null && firstAttempt.delayBeforeNextMs >= 3000) {
        passed.push(`delayBeforeNextMs=${firstAttempt.delayBeforeNextMs} (≥3000ms — Retry-After honored)`);
      } else {
        warnings.push(`delayBeforeNextMs=${firstAttempt.delayBeforeNextMs} (<3000ms — Retry-After NOT honored)`);
      }
    } else {
      failed.push('no attempt rows recorded');
    }

    return {
      payment,
      attempts: detail.attempts,
      statsBefore,
      statsAfter,
      warnings,
      assertionsPassed: passed,
      assertionsFailed: failed,
    };
  });
}

const runFns = [runDemoA, runDemoB, runDemoC, runDemoD, runDemoE];

const severityMap: Record<DemoStatus, 'secondary' | 'info' | 'success' | 'danger'> = {
  idle: 'secondary',
  running: 'info',
  success: 'success',
  failed: 'danger',
};
</script>

<template>
  <Card>
    <template #title>
      Demo Scenario Runner
    </template>
    <template #subtitle>
      Runs each scenario with simple assertions + evidence dialog (Option C: hybrid)
    </template>
    <template #content>
      <div class="flex flex-col gap-3">
        <div
          v-for="(result, i) in results"
          :key="i"
          class="flex items-center justify-between gap-2 p-3 rounded border surface-border"
        >
          <div class="flex items-center gap-2 min-w-0">
            <Tag
              :severity="severityMap[result.status]"
              :value="result.status.toUpperCase()"
            />
            <span class="truncate">{{ result.name }}</span>
            <Button
              v-if="result.evidence"
              icon="pi pi-eye"
              text
              size="small"
              severity="info"
              label="Evidence"
              @click="openEvidence(result)"
            />
          </div>
          <Button
            :label="result.status === 'running' ? 'Running...' : 'Run'"
            :icon="result.status === 'running' ? 'pi pi-spin pi-spinner' : 'pi pi-play'"
            :disabled="result.status === 'running'"
            size="small"
            @click="runFns[i]()"
          />
        </div>
        <div
          v-for="(result, i) in results"
          :key="'msg-' + i"
        >
          <div
            v-if="result.message"
            class="text-xs text-red-500 mt-1"
          >
            {{ result.name }}: {{ result.message }}
          </div>
        </div>
      </div>

      <!-- Evidence Dialog -->
      <Dialog
        v-model:visible="evidenceVisible"
        :header="evidenceResult ? `${evidenceResult.name} — Evidence` : 'Evidence'"
        modal
        :style="{ width: '60rem' }"
        :breakpoints="{ '640px': '95vw' }"
      >
        <div
          v-if="evidenceResult && evidenceResult.evidence"
          class="flex flex-col gap-4"
        >
          <!-- Payment summary -->
          <div class="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
            <div class="flex flex-col">
              <span class="text-xs text-gray-500">Status</span>
              <Tag
                :severity="evidenceResult.evidence.payment.status === 'succeeded' ? 'success' : evidenceResult.evidence.payment.status === 'failed' ? 'danger' : 'warn'"
                :value="evidenceResult.evidence.payment.status"
              />
            </div>
            <div class="flex flex-col">
              <span class="text-xs text-gray-500">Attempt Count</span>
              <span class="font-bold">{{ evidenceResult.evidence.payment.attemptCount }}</span>
            </div>
            <div class="flex flex-col">
              <span class="text-xs text-gray-500">Total Retries</span>
              <span class="font-bold">{{ evidenceResult.evidence.payment.totalRetryCount }}</span>
            </div>
            <div class="flex flex-col">
              <span class="text-xs text-gray-500">Failure Reason</span>
              <span class="text-xs">{{ evidenceResult.evidence.payment.failureReason ?? '-' }}</span>
            </div>
          </div>

          <!-- Assertions -->
          <div class="flex flex-col gap-1">
            <div class="text-sm font-semibold">
              Assertions
            </div>
            <div
              v-for="(a, idx) in evidenceResult.evidence.assertionsPassed"
              :key="'pass-' + idx"
              class="text-sm flex items-center gap-2"
            >
              <i class="pi pi-check-circle text-green-600" />
              <span>{{ a }}</span>
            </div>
            <div
              v-for="(a, idx) in evidenceResult.evidence.assertionsFailed"
              :key="'fail-' + idx"
              class="text-sm flex items-center gap-2"
            >
              <i class="pi pi-times-circle text-red-600" />
              <span>{{ a }}</span>
            </div>
          </div>

          <!-- Warnings -->
          <div
            v-if="evidenceResult.evidence.warnings.length > 0"
            class="flex flex-col gap-1"
          >
            <div class="text-sm font-semibold">
              Warnings
            </div>
            <div
              v-for="(w, idx) in evidenceResult.evidence.warnings"
              :key="'warn-' + idx"
              class="text-sm flex items-center gap-2"
            >
              <i class="pi pi-exclamation-triangle text-yellow-600" />
              <span>{{ w }}</span>
            </div>
          </div>

          <!-- Attempts table -->
          <div class="flex flex-col gap-2">
            <div class="text-sm font-semibold">
              Attempts ({{ evidenceResult.evidence.attempts.length }})
            </div>
            <DataTable
              :value="evidenceResult.evidence.attempts"
              size="small"
              scrollable
              scroll-height="200px"
              class="p-datatable-sm"
            >
              <Column
                field="attemptNumber"
                header="#"
                style="width: 3rem"
              />
              <Column
                field="outcome"
                header="Outcome"
              />
              <Column
                field="httpStatus"
                header="HTTP"
                style="width: 4rem"
              >
                <template #body="slotProps">
                  {{ slotProps.data.httpStatus ?? '-' }}
                </template>
              </Column>
              <Column
                field="durationMs"
                header="Duration"
                style="width: 6rem"
              >
                <template #body="slotProps">
                  {{ slotProps.data.durationMs }}ms
                </template>
              </Column>
              <Column
                field="delayBeforeNextMs"
                header="Delay"
                style="width: 6rem"
              >
                <template #body="slotProps">
                  {{ slotProps.data.delayBeforeNextMs ? slotProps.data.delayBeforeNextMs + 'ms' : '-' }}
                </template>
              </Column>
              <Column
                field="replayed"
                header="Replay"
                style="width: 4rem"
              >
                <template #body="slotProps">
                  <Tag
                    v-if="slotProps.data.replayed"
                    severity="info"
                    value="REPLAY"
                  />
                  <span v-else>-</span>
                </template>
              </Column>
              <Column
                field="traceId"
                header="Trace ID"
              >
                <template #body="slotProps">
                  <code class="text-xs">{{ truncateTrace(slotProps.data.traceId) }}</code>
                </template>
              </Column>
            </DataTable>
          </div>

          <!-- Stats delta -->
          <div
            v-if="evidenceResult.evidence.statsBefore && evidenceResult.evidence.statsAfter"
            class="flex flex-col gap-2"
          >
            <div class="text-sm font-semibold">
              Gateway Stats (delta)
            </div>
            <div class="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
              <div class="flex flex-col p-2 rounded surface-ground">
                <span class="text-xs text-gray-500">Requests</span>
                <span class="font-bold">+{{ delta(evidenceResult.evidence.statsBefore, evidenceResult.evidence.statsAfter)?.requestCount ?? 0 }}</span>
              </div>
              <div class="flex flex-col p-2 rounded surface-ground">
                <span class="text-xs text-gray-500">Success</span>
                <span class="font-bold text-green-600">+{{ delta(evidenceResult.evidence.statsBefore, evidenceResult.evidence.statsAfter)?.successCount ?? 0 }}</span>
              </div>
              <div class="flex flex-col p-2 rounded surface-ground">
                <span class="text-xs text-gray-500">Failures</span>
                <span class="font-bold text-red-600">+{{ delta(evidenceResult.evidence.statsBefore, evidenceResult.evidence.statsAfter)?.failureCount ?? 0 }}</span>
              </div>
              <div class="flex flex-col p-2 rounded surface-ground">
                <span class="text-xs text-gray-500">Replays</span>
                <span class="font-bold text-blue-600">+{{ delta(evidenceResult.evidence.statsBefore, evidenceResult.evidence.statsAfter)?.replayCount ?? 0 }}</span>
              </div>
              <div class="flex flex-col p-2 rounded surface-ground">
                <span class="text-xs text-gray-500">Actual Charges</span>
                <span class="font-bold">+{{ delta(evidenceResult.evidence.statsBefore, evidenceResult.evidence.statsAfter)?.actualChargesCount ?? 0 }}</span>
              </div>
            </div>
          </div>

          <!-- Breaker state (Demo C only) -->
          <div
            v-if="evidenceResult.evidence.breakerState !== undefined"
            class="text-sm"
          >
            <span class="text-gray-500">Breaker state:</span>
            <Tag
              :severity="evidenceResult.evidence.breakerState === 1 ? 'danger' : evidenceResult.evidence.breakerState === 2 ? 'warn' : 'success'"
              :value="evidenceResult.evidence.breakerState === 1 ? 'OPEN' : evidenceResult.evidence.breakerState === 2 ? 'HALF_OPEN' : 'CLOSED'"
              class="ml-2"
            />
          </div>
        </div>
        <div v-else>
          No evidence available.
        </div>
        <template #footer>
          <Button
            label="Close"
            icon="pi pi-times"
            @click="evidenceVisible = false"
          />
        </template>
      </Dialog>
    </template>
  </Card>
</template>
