<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import { useMetricsStore } from '../stores/metrics';
import { usePolling } from '../composables/usePolling';

const metricsStore = useMetricsStore();
const showRaw = ref(false);
const { start } = usePolling(() => metricsStore.refresh(), 5000);

onMounted(() => start());

// Status colors mapping
const statusColors: Record<string, string> = {
  processing: '#3b82f6',
  succeeded: '#22c55e',
  failed: '#ef4444',
  scheduled_for_retry: '#eab308',
};

// Common chart options for dark mode support
const pieOptions = {
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: {
      position: 'bottom' as const,
      labels: {
        color: 'var(--p-text-color, #333)',
        padding: 10,
        font: { size: 11 },
      },
    },
    tooltip: {
      enabled: true,
    },
  },
};

const barOptions = {
  responsive: true,
  maintainAspectRatio: true,
  plugins: {
    legend: {
      position: 'top' as const,
      labels: {
        color: 'var(--p-text-color, #333)',
        font: { size: 11 },
      },
    },
  },
  scales: {
    y: {
      beginAtZero: true,
      ticks: {
        color: 'var(--p-text-color-secondary, #999)',
        font: { size: 10 },
      },
      grid: {
        color: 'var(--p-content-border-color, #e5e7eb)',
      },
    },
    x: {
      ticks: {
        color: 'var(--p-text-color-secondary, #999)',
        font: { size: 10 },
        maxRotation: 45,
        minRotation: 0,
      },
      grid: {
        display: false,
      },
    },
  },
};

const statusData = computed(() => {
  const m = metricsStore.parsed?.paymentsCurrentStatus;
  if (!m || Object.keys(m).length === 0) return null;
  const labels = Object.keys(m);
  return {
    labels,
    datasets: [{
      data: Object.values(m),
      backgroundColor: labels.map((l) => statusColors[l] ?? '#6b7280'),
      borderColor: labels.map((l) => statusColors[l] ?? '#6b7280'),
      borderWidth: 1,
    }],
  };
});

const gatewayRequestsData = computed(() => {
  const m = metricsStore.parsed?.gatewayRequestsTotal;
  if (!m || Object.keys(m).length === 0) return null;
  const entries = Object.entries(m);
  return {
    labels: entries.map(([k]) => k.replace(/"/g, '')),
    datasets: [{
      label: 'Gateway Requests',
      data: entries.map(([, v]) => v),
      backgroundColor: '#3b82f6',
      borderRadius: 4,
    }],
  };
});

const retryAttemptsData = computed(() => {
  const m = metricsStore.parsed?.retryAttemptsTotal;
  if (!m || Object.keys(m).length === 0) return null;
  const entries = Object.entries(m);
  return {
    labels: entries.map(([k]) => k.replace(/"/g, '')),
    datasets: [{
      label: 'Retry Attempts',
      data: entries.map(([, v]) => v),
      backgroundColor: '#f59e0b',
      borderRadius: 4,
    }],
  };
});
</script>

<template>
  <div class="p-4">
    <h2 class="text-xl font-bold mb-4">
      Metrics
    </h2>

    <div
      v-if="metricsStore.lastUpdated"
      class="text-xs text-gray-500 mb-3"
    >
      Last updated: {{ metricsStore.lastUpdated.toLocaleTimeString() }}
      <Button
        label="Refresh"
        icon="pi pi-refresh"
        size="small"
        text
        :loading="metricsStore.loading"
        @click="metricsStore.refresh()"
      />
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
      <Card>
        <template #title>
          Payment Status Distribution
        </template>
        <template #content>
          <div class="chart-container">
            <Chart
              v-if="statusData"
              type="pie"
              :data="statusData"
              :options="pieOptions"
            />
            <div
              v-else
              class="text-gray-500 text-center py-8"
            >
              No payment data available
            </div>
          </div>
        </template>
      </Card>

      <Card>
        <template #title>
          Gateway Requests
        </template>
        <template #content>
          <div class="chart-container">
            <Chart
              v-if="gatewayRequestsData"
              type="bar"
              :data="gatewayRequestsData"
              :options="barOptions"
            />
            <div
              v-else
              class="text-gray-500 text-center py-8"
            >
              No gateway request data available
            </div>
          </div>
        </template>
      </Card>

      <Card>
        <template #title>
          Retry Attempts
        </template>
        <template #content>
          <div class="chart-container">
            <Chart
              v-if="retryAttemptsData"
              type="bar"
              :data="retryAttemptsData"
              :options="barOptions"
            />
            <div
              v-else
              class="text-gray-500 text-center py-8"
            >
              No retry attempt data available
            </div>
          </div>
        </template>
      </Card>

      <Card>
        <template #title>
          Raw Metrics
        </template>
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

<style scoped>
.chart-container {
  min-height: 250px;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
