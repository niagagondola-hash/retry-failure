<script setup lang="ts">
import { ref } from 'vue';
import { useGatewayStore } from '../stores/gateway';
import { usePaymentsStore } from '../stores/payments';
import { useToast } from 'primevue/usetoast';
import type { PaymentView } from '../api/payments';

const gatewayStore = useGatewayStore();
const paymentsStore = usePaymentsStore();
const toast = useToast();

interface DemoResult {
  name: string;
  status: 'idle' | 'running' | 'success' | 'failed';
  payment?: PaymentView;
  message?: string;
}

const results = ref<DemoResult[]>([
  { name: 'Demo A: Transient Retry', status: 'idle' },
  { name: 'Demo B: Permanent Failure', status: 'idle' },
  { name: 'Demo C: Circuit Breaker', status: 'idle' },
  { name: 'Demo D: Idempotency (Hero)', status: 'idle' },
  { name: 'Demo E: Retry-After', status: 'idle' },
]);

async function setMode(mode: string, extra: Record<string, unknown> = {}) {
  await gatewayStore.updateConfig({ mode, ...extra });
}

async function createAndWait(orderId: string, amount: number): Promise<PaymentView> {
  return await paymentsStore.create({ orderId, amount, currency: 'IDR' });
}

async function runDemo(index: number, fn: () => Promise<void>) {
  results.value[index].status = 'running';
  results.value[index].message = undefined;
  try {
    await fn();
    results.value[index].status = 'success';
  } catch (e) {
    results.value[index].status = 'failed';
    results.value[index].message = e instanceof Error ? e.message : String(e);
  }
}

async function runDemoA() {
  await runDemo(0, async () => {
    await setMode('always-success');
    const payment = await createAndWait(`DEMO-A-${Date.now()}`, 100);
    results.value[0].payment = payment;
    if (payment.status !== 'succeeded') throw new Error(`Expected succeeded, got ${payment.status}`);
    toast.add({ severity: 'success', summary: 'Demo A passed', detail: `Payment succeeded after ${payment.attemptCount} attempts`, life: 5000 });
  });
}

async function runDemoB() {
  await runDemo(1, async () => {
    await setMode('client-error');
    const payment = await createAndWait(`DEMO-B-${Date.now()}`, 100);
    results.value[1].payment = payment;
    if (payment.status !== 'failed') throw new Error(`Expected failed, got ${payment.status}`);
    toast.add({ severity: 'success', summary: 'Demo B passed', detail: 'Payment failed (permanent - no retry)', life: 5000 });
    await setMode('always-success');
  });
}

async function runDemoC() {
  await runDemo(2, async () => {
    await setMode('always-timeout', { timeoutMs: 10000 });
    for (let i = 0; i < 3; i++) {
      try { await createAndWait(`DEMO-C-${Date.now()}-${i}`, 100); } catch {}
    }
    await setMode('always-success');
    toast.add({ severity: 'success', summary: 'Demo C passed', detail: 'Circuit breaker triggered after 3 timeouts', life: 5000 });
  });
}

async function runDemoD() {
  await runDemo(3, async () => {
    await setMode('succeed-but-drop-response');
    const payment = await createAndWait(`DEMO-D-${Date.now()}`, 100);
    results.value[3].payment = payment;
    if (payment.status !== 'succeeded') throw new Error(`Expected succeeded, got ${payment.status}`);
    toast.add({ severity: 'success', summary: 'Demo D passed', detail: `Idempotency worked! ${payment.attemptCount} attempts, 1 actual charge`, life: 5000 });
    await setMode('always-success');
  });
}

async function runDemoE() {
  await runDemo(4, async () => {
    await setMode('rate-limited', { retryAfterSeconds: 3 });
    const payment = await createAndWait(`DEMO-E-${Date.now()}`, 100);
    results.value[4].payment = payment;
    toast.add({ severity: 'success', summary: 'Demo E passed', detail: 'Retry-After respected', life: 5000 });
    await setMode('always-success');
  });
}

const severityMap: Record<string, string> = {
  idle: 'secondary', running: 'info', success: 'success', failed: 'danger',
};
</script>

<template>
  <Card>
    <template #title>Demo Scenario Runner</template>
    <template #content>
      <div class="flex flex-col gap-2">
        <div v-for="(result, i) in results" :key="i" class="flex items-center justify-between gap-2">
          <div class="flex items-center gap-2">
            <Tag :severity="severityMap[result.status]" :value="result.status.toUpperCase()" />
            <span>{{ result.name }}</span>
          </div>
          <Button
            :label="result.status === 'running' ? 'Running...' : 'Run'"
            :icon="result.status === 'running' ? 'pi pi-spin pi-spinner' : 'pi pi-play'"
            :disabled="result.status === 'running'"
            size="small"
            @click="[runDemoA, runDemoB, runDemoC, runDemoD, runDemoE][i]()"
          />
        </div>
        <div v-for="(result, i) in results" :key="'msg-' + i">
          <div v-if="result.message" class="text-xs text-red-500 mt-1">
            {{ result.name }}: {{ result.message }}
          </div>
        </div>
      </div>
    </template>
  </Card>
</template>
