<script setup lang="ts">
import { onMounted, computed, ref } from 'vue';
import { useRoute } from 'vue-router';
import { usePaymentsStore } from '../stores/payments';
import { useToast } from 'primevue/usetoast';
import StatusTag from '../components/StatusTag.vue';
import AttemptTimeline from '../components/AttemptTimeline.vue';

const route = useRoute();
const paymentsStore = usePaymentsStore();
const toast = useToast();

const paymentId = computed(() => route.params.id as string);
const canRetry = computed(() => {
  const status = paymentsStore.current?.payment?.status;
  return status === 'failed' || status === 'scheduled_for_retry';
});

onMounted(async () => {
  await paymentsStore.fetchOne(paymentId.value);
});

async function retry() {
  try {
    await paymentsStore.retry(paymentId.value);
    toast.add({ severity: 'success', summary: 'Payment retried', life: 2000 });
  } catch {
    toast.add({ severity: 'error', summary: 'Retry failed', life: 3000 });
  }
}
</script>

<template>
  <div
    v-if="paymentsStore.current"
    class="p-4"
  >
    <div class="flex items-center justify-between mb-4">
      <h2 class="text-xl font-bold">
        Payment Detail
      </h2>
      <Button
        v-if="canRetry"
        label="Manual Retry"
        icon="pi pi-refresh"
        :loading="paymentsStore.loading"
        @click="retry"
      />
    </div>

    <Card class="mb-4">
      <template #title>
        Payment Info
      </template>
      <template #content>
        <div class="grid grid-cols-2 gap-3">
          <div><strong>ID:</strong> {{ paymentsStore.current.payment.id }}</div>
          <div><strong>Order ID:</strong> {{ paymentsStore.current.payment.orderId }}</div>
          <div><strong>Amount:</strong> {{ paymentsStore.current.payment.amount }} {{ paymentsStore.current.payment.currency }}</div>
          <div><strong>Status:</strong> <StatusTag :status="paymentsStore.current.payment.status" /></div>
          <div><strong>Attempts:</strong> {{ paymentsStore.current.payment.attemptCount }}</div>
          <div><strong>Total Retries:</strong> {{ paymentsStore.current.payment.totalRetryCount }}</div>
          <div v-if="paymentsStore.current.payment.gatewayReference">
            <strong>Gateway Ref:</strong> {{ paymentsStore.current.payment.gatewayReference }}
          </div>
          <div v-if="paymentsStore.current.payment.failureReason">
            <strong>Failure Reason:</strong> {{ paymentsStore.current.payment.failureReason }}
          </div>
          <div v-if="paymentsStore.current.payment.nextRetryAt">
            <strong>Next Retry:</strong> {{ new Date(paymentsStore.current.payment.nextRetryAt).toLocaleString() }}
          </div>
        </div>
      </template>
    </Card>

    <Card>
      <template #title>
        Attempt History ({{ paymentsStore.current.attempts.length }})
      </template>
      <template #content>
        <AttemptTimeline :attempts="paymentsStore.current.attempts" />
      </template>
    </Card>
  </div>

  <div
    v-else-if="paymentsStore.loading"
    class="p-4"
  >
    <ProgressSpinner />
  </div>

  <div
    v-else
    class="p-4 text-center text-gray-500"
  >
    Payment not found.
  </div>
</template>
