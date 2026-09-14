<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import { useMetricsStore } from '../stores/metrics';
import { usePolling } from '../composables/usePolling';

const metricsStore = useMetricsStore();
const showRaw = ref(false);
const { start } = usePolling(() => metricsStore.refresh(), 5000);

onMounted(() => start());

const statusData = computed(() => {
  const m = metricsStore.parsed?.paymentsCurrentStatus;
  if (!m) return null;
  return {
    labels: Object.keys(m),
    datasets: [{
      data: Object.values(m),
      backgroundColor: ['#3b82f6', '#22c55e', '#ef4444', '#eab308'],
    }],
  };
});

const gatewayRequestsData = computed(() => {
  const m = metricsStore.parsed?.gatewayRequestsTotal;
  if (!m) return null;
  const entries = Object.entries(m);
  return {
    labels: entries.map(([k]) => k),
    datasets: [{
      label: 'Count',
      data: entries.map(([, v]) => v),
      backgroundColor: '#3b82f6',
    }],
  };
});

const retryAttemptsData = computed(() => {
  const m = metricsStore.parsed?.retryAttemptsTotal;
  if (!m) return null;
  const entries = Object.entries(m);
  return {
    labels: entries.map(([k]) => k),
    datasets: [{
      label: 'Count',
      data: entries.map(([, v]) => v),
      backgroundColor: '#f59e0b',
    }],
  };
});
</script>

<template>
  <div class="p-4">
    <h2 class="text-xl font-bold mb-4">Metrics</h2>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <Card>
        <template #title>Payment Status Distribution</template>
        <template #content>
          <Chart v-if="statusData" type="pie" :data="statusData" />
          <div v-else class="text-gray-500">No data</div>
        </template>
      </Card>

      <Card>
        <template #title>Gateway Requests</template>
        <template #content>
          <Chart v-if="gatewayRequestsData" type="bar" :data="gatewayRequestsData" />
          <div v-else class="text-gray-500">No data</div>
        </template>
      </Card>

      <Card>
        <template #title>Retry Attempts</template>
        <template #content>
          <Chart v-if="retryAttemptsData" type="bar" :data="retryAttemptsData" />
          <div v-else class="text-gray-500">No data</div>
        </template>
      </Card>

      <Card>
        <template #title>Raw Metrics</template>
        <template #content>
          <Button
            :label="showRaw ? 'Hide' : 'Show Raw'"
            :icon="showRaw ? 'pi pi-eye-slash' : 'pi pi-eye'"
            size="small"
            @click="showRaw = !showRaw"
          />
          <Textarea
            v-if="showRaw"
            :model-value="metricsStore.raw"
            rows="15"
            class="w-full mt-2 font-mono text-xs"
            readonly
          />
        </template>
      </Card>
    </div>
  </div>
</template>
