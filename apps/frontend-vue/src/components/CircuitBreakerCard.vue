<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useMetricsStore } from '../stores/metrics';
import { usePolling } from '../composables/usePolling';

const metricsStore = useMetricsStore();
const { start } = usePolling(() => metricsStore.refresh(), 5000);

onMounted(() => start());

const breakerState = computed(() => {
  const val = metricsStore.parsed?.circuitBreakerState;
  if (val === 1) return { label: 'OPEN', severity: 'danger' };
  if (val === 2) return { label: 'HALF_OPEN', severity: 'warn' };
  return { label: 'CLOSED', severity: 'success' };
});

const replayCount = computed(() => metricsStore.parsed?.gatewayIdempotentReplaysTotal ?? 0);
</script>

<template>
  <Card>
    <template #title>Circuit Breaker</template>
    <template #content>
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between">
          <span>State:</span>
          <Tag :severity="breakerState.severity" :value="breakerState.label" />
        </div>
        <div class="flex items-center justify-between">
          <span>Replays:</span>
          <span class="font-bold">{{ replayCount }}</span>
        </div>
        <div v-if="metricsStore.lastUpdated" class="text-xs text-gray-500">
          Updated: {{ metricsStore.lastUpdated.toLocaleTimeString() }}
        </div>
      </div>
    </template>
  </Card>
</template>
