import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as paymentsApi from '../api/payments';
import type { PaymentView, PaymentDetail } from '../api/payments';

export const usePaymentsStore = defineStore('payments', () => {
  const list = ref<PaymentView[]>([]);
  const current = ref<PaymentDetail | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const filter = ref<string | undefined>(undefined);

  async function fetchList() {
    loading.value = true;
    error.value = null;
    try {
      list.value = await paymentsApi.listPayments(filter.value);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function fetchOne(id: string) {
    loading.value = true;
    error.value = null;
    try {
      current.value = await paymentsApi.getPaymentById(id);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function create(input: { orderId: string; amount: number; currency: string }) {
    loading.value = true;
    error.value = null;
    try {
      const payment = await paymentsApi.createPayment(input);
      await fetchList();
      return payment;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function retry(id: string) {
    loading.value = true;
    error.value = null;
    try {
      const payment = await paymentsApi.retryPayment(id);
      await fetchOne(id);
      await fetchList();
      return payment;
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  function setFilter(status?: string) {
    filter.value = status;
  }

  function resetFilter() {
    filter.value = undefined;
  }

  return { list, current, loading, error, filter, fetchList, fetchOne, create, retry, setFilter, resetFilter };
});
