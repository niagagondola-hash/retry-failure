<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue';
import { usePaymentsStore } from '../stores/payments';
import { useGatewayStore } from '../stores/gateway';
import { usePolling } from '../composables/usePolling';
import GatewayModeSelector from '../components/GatewayModeSelector.vue';
import CreatePaymentDialog from '../components/CreatePaymentDialog.vue';
import CircuitBreakerCard from '../components/CircuitBreakerCard.vue';
import DemoScenarioRunner from '../components/DemoScenarioRunner.vue';
import StatusTag from '../components/StatusTag.vue';

const paymentsStore = usePaymentsStore();
const gatewayStore = useGatewayStore();

const {
  isPolling,
  isRefreshing,
  lastRefreshedAt,
  start: startPaymentsPoll,
  stop: stopPaymentsPoll,
  toggle: togglePaymentsPoll,
  refreshNow: refreshPaymentsNow,
} = usePolling(() => paymentsStore.fetchList(), 3000);

onMounted(async () => {
  await paymentsStore.fetchList();
  await gatewayStore.fetchConfig();
  startPaymentsPoll();
});

onUnmounted(() => stopPaymentsPoll());

const succeededCount = computed(() => paymentsStore.list.filter(p => p.status === 'succeeded').length);
const failedCount = computed(() => paymentsStore.list.filter(p => p.status === 'failed').length);
const scheduledCount = computed(() => paymentsStore.list.filter(p => p.status === 'scheduled_for_retry').length);

const lastRefreshedLabel = computed(() => {
  if (!lastRefreshedAt.value) return 'never';
  return lastRefreshedAt.value.toLocaleTimeString();
});
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

    <!-- Polling Controls -->
    <div class="col-span-full">
      <Card>
        <template #title>
          Auto-Refresh Controls
        </template>
        <template #subtitle>
          Live payment list polling — toggle on/off or refresh manually
        </template>
        <template #content>
          <div class="flex flex-wrap items-center gap-3">
            <div class="flex items-center gap-2">
              <ToggleSwitch
                :model-value="isPolling"
                @update:model-value="togglePaymentsPoll"
              />
              <span class="text-sm">
                Polling: <Tag
                  :severity="isPolling ? 'success' : 'secondary'"
                  :value="isPolling ? 'ON' : 'OFF'"
                />
              </span>
            </div>
            <Button
              label="Refresh Now"
              icon="pi pi-refresh"
              size="small"
              severity="info"
              :loading="isRefreshing"
              :disabled="isRefreshing"
              @click="refreshPaymentsNow"
            />
            <div class="text-xs text-gray-500">
              Last refreshed: {{ lastRefreshedLabel }}
            </div>
          </div>
        </template>
      </Card>
    </div>

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
