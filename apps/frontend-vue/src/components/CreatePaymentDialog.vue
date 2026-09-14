<script setup lang="ts">
import { ref } from 'vue';
import { usePaymentsStore } from '../stores/payments';
import { useToast } from 'primevue/usetoast';

const paymentsStore = usePaymentsStore();
const toast = useToast();
const emit = defineEmits<{ created: [] }>();

const visible = ref(false);
const orderId = ref('');
const amount = ref(100);
const currency = ref('IDR');

async function submit() {
  if (!orderId.value || amount.value <= 0) {
    toast.add({ severity: 'warn', summary: 'Please fill all fields', life: 3000 });
    return;
  }
  try {
    await paymentsStore.create({
      orderId: orderId.value,
      amount: amount.value,
      currency: currency.value,
    });
    toast.add({ severity: 'success', summary: 'Payment created', life: 2000 });
    visible.value = false;
    orderId.value = '';
    amount.value = 100;
    emit('created');
  } catch {
    toast.add({ severity: 'error', summary: 'Failed to create payment', life: 3000 });
  }
}
</script>

<template>
  <Button
    label="Create Payment"
    icon="pi pi-plus"
    @click="visible = true"
  />
  <Dialog
    v-model:visible="visible"
    header="Create Payment"
    modal
    class="w-96"
  >
    <div class="flex flex-col gap-3 p-3">
      <div class="flex flex-col gap-1">
        <label>Order ID</label>
        <InputText
          v-model="orderId"
          placeholder="ORD-001"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label>Amount</label>
        <InputNumber
          v-model="amount"
          :min="1"
          :max="1000000"
          mode="decimal"
          :min-fraction-digits="2"
        />
      </div>
      <div class="flex flex-col gap-1">
        <label>Currency</label>
        <Select
          v-model="currency"
          :options="['IDR', 'USD', 'SGD', 'EUR']"
        />
      </div>
    </div>
    <template #footer>
      <Button
        label="Cancel"
        severity="secondary"
        @click="visible = false"
      />
      <Button
        label="Create"
        icon="pi pi-check"
        :loading="paymentsStore.loading"
        @click="submit"
      />
    </template>
  </Dialog>
</template>
