<script setup lang="ts">
import { onMounted, computed } from 'vue';
import { usePaymentsStore } from '../stores/payments';
import { useGatewayStore } from '../stores/gateway';
import { useMetricsStore } from '../stores/metrics';
import { usePolling } from '../composables/usePolling';
import GatewayModeSelector from '../components/GatewayModeSelector.vue';
import CreatePaymentDialog from '../components/CreatePaymentDialog.vue';
import CircuitBreakerCard from '../components/CircuitBreakerCard.vue';
import DemoScenarioRunner from '../components/DemoScenarioRunner.vue';
import StatusTag from '../components/StatusTag.vue';

const paymentsStore = usePaymentsStore();
const gatewayStore = useGatewayStore();
const metricsStore = useMetricsStore();
const { start: startPaymentsPoll } = usePolling(() => paymentsStore.fetchList(), 3000);

onMounted(async () => {
  await paymentsStore.fetchList();
  await gatewayStore.fetchConfig();
  startPaymentsPoll();
});

const succeededCount = computed(() => paymentsStore.list.filter(p => p.status === 'succeeded').length);
const failedCount = computed(() => paymentsStore.list.filter(p => p.status === 'failed').length);
const scheduledCount = computed(() => paymentsStore.list.filter(p => p.status === 'scheduled_for_retry').length);
</script>

<template>
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
    <!-- Stats Cards -->
    <Card>
      <template #title>
        Total Payments
      </template>
      <template #content>
        <div class="text-3xl font-bold">
          {{ paymentsStore.list.length }}
        </div>
      </template>
    </Card>
    <Card>
      <template #title>
        Succeeded
      </template>
      <template #content>
        <div class="text-3xl font-bold text-green-600">
          {{ succeededCount }}
        </div>
      </template>
    </Card>
    <Card>
      <template #title>
        Failed
      </template>
      <template #content>
        <div class="text-3xl font-bold text-red-600">
          {{ failedCount }}
        </div>
      </template>
    </Card>

    <!-- Gateway Mode + Create Payment -->
    <GatewayModeSelector />
    <div class="flex flex-col gap-4">
      <CreatePaymentDialog @created="paymentsStore.fetchList()" />
      <Card>
        <template #title>
          Scheduled for Retry
        </template>
        <template #content>
          <div class="text-3xl font-bold text-yellow-600">
            {{ scheduledCount }}
          </div>
        </template>
      </Card>
    </div>
    <CircuitBreakerCard />

    <!-- Demo Scenarios -->
    <div class="col-span-full">
      <DemoScenarioRunner />
    </div>

    <!-- Recent Payments -->
    <div class="col-span-full">
      <Card>
        <template #title>
          Recent Payments
        </template>
        <template #content>
          <DataTable
            :value="paymentsStore.list.slice(0, 5)"
            :loading="paymentsStore.loading"
            class="p-datatable-sm"
          >
            <Column
              field="orderId"
              header="Order ID"
            />
            <Column
              field="amount"
              header="Amount"
            />
            <Column
              field="currency"
              header="Currency"
            />
            <Column header="Status">
              <template #body="slotProps">
                <StatusTag :status="slotProps.data.status" />
              </template>
            </Column>
            <Column
              field="attemptCount"
              header="Attempts"
            />
            <Column
              field="totalRetryCount"
              header="Retries"
            />
          </DataTable>
        </template>
      </Card>
    </div>
  </div>
</template>
