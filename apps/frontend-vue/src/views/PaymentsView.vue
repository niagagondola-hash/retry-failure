<script setup lang="ts">
import { onMounted, ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { usePaymentsStore } from '../stores/payments';
import { usePolling } from '../composables/usePolling';
import CreatePaymentDialog from '../components/CreatePaymentDialog.vue';
import StatusTag from '../components/StatusTag.vue';

const router = useRouter();
const paymentsStore = usePaymentsStore();
const statusFilter = ref<string | null>(null);
const { start } = usePolling(() => paymentsStore.fetchList(), 3000);

onMounted(async () => {
  await paymentsStore.fetchList();
  start();
});

const filteredList = computed(() => {
  if (!statusFilter.value) return paymentsStore.list;
  return paymentsStore.list.filter(p => p.status === statusFilter.value);
});

function onRowClick(event: { data: { id: string } }) {
  router.push(`/payments/${event.data.id}`);
}
</script>

<template>
  <div class="p-4">
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-bold">Payments</h2>
      <CreatePaymentDialog @created="paymentsStore.fetchList()" />
    </div>

    <div class="flex items-center gap-3 mb-4">
      <Select
        v-model="statusFilter"
        :options="[null, 'processing', 'succeeded', 'failed', 'scheduled_for_retry']"
        optionLabel="null"
        placeholder="Filter by status"
        class="w-48"
      />
    </div>

    <DataTable
      :value="filteredList"
      :loading="paymentsStore.loading"
      paginator
      :rows="20"
      :rowsPerPageOptions="[10, 20, 50]"
      @row-click="onRowClick"
      class="cursor-pointer"
    >
      <Column field="orderId" header="Order ID" sortable />
      <Column field="amount" header="Amount" sortable />
      <Column field="currency" header="Currency" />
      <Column header="Status">
        <template #body="slotProps">
          <StatusTag :status="slotProps.data.status" />
        </template>
      </Column>
      <Column field="attemptCount" header="Attempts" sortable />
      <Column field="totalRetryCount" header="Retries" sortable />
      <Column field="createdAt" header="Created" sortable>
        <template #body="slotProps">
          {{ new Date(slotProps.data.createdAt).toLocaleString() }}
        </template>
      </Column>
    </DataTable>
  </div>
</template>
