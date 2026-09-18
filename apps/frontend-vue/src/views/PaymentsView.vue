<script setup lang="ts">
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { usePaymentsStore } from '../stores/payments';
import CreatePaymentDialog from '../components/CreatePaymentDialog.vue';
import StatusTag from '../components/StatusTag.vue';

const router = useRouter();
const paymentsStore = usePaymentsStore();
const statusFilter = ref<string | null>(null);

// NOTE: polling lifecycle is owned by global polling store (started in App.vue).
// PaymentsView just reads paymentsStore.list which gets updated by the global timer.

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
      <h2 class="text-xl font-bold">
        Payments
      </h2>
      <CreatePaymentDialog @created="paymentsStore.fetchList()" />
    </div>

    <div class="flex items-center gap-3 mb-4">
      <Select
        v-model="statusFilter"
        :options="[null, 'processing', 'succeeded', 'failed', 'scheduled_for_retry']"
        option-label="null"
        placeholder="Filter by status"
        class="w-48"
      />
    </div>

    <DataTable
      :value="filteredList"
      :loading="paymentsStore.loading"
      paginator
      :rows="20"
      :rows-per-page-options="[10, 20, 50]"
      class="cursor-pointer"
      @row-click="onRowClick"
    >
      <Column
        field="orderId"
        header="Order ID"
        sortable
      />
      <Column
        field="amount"
        header="Amount"
        sortable
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
        sortable
      />
      <Column
        field="totalRetryCount"
        header="Retries"
        sortable
      />
      <Column
        field="createdAt"
        header="Created"
        sortable
      >
        <template #body="slotProps">
          {{ new Date(slotProps.data.createdAt).toLocaleString() }}
        </template>
      </Column>
    </DataTable>
  </div>
</template>
