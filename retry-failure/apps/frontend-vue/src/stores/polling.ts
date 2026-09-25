import { defineStore } from 'pinia';
import { ref } from 'vue';
import { usePaymentsStore } from './payments';
import { useMetricsStore } from './metrics';

/**
 * Global polling store — single source of truth for polling on/off state.
 *
 * Drives TWO independent timers with domain-appropriate intervals:
 *   - payments list @ 3000ms  (state data, changes fast during demos)
 *   - metrics       @ 5000ms  (counters/gauges, slower churn)
 *
 * Consumers:
 *   - App.vue             → start() on app mount
 *   - HomeView.vue        → toggle UI + "Refresh Now" (refreshes both)
 *   - MetricsView.vue     → toggle UI + "Refresh" (refreshes both)
 *   - CircuitBreakerCard  → reads metricsStore (auto-updated, no own polling)
 *   - PaymentsView        → reads paymentsStore (auto-updated, no own polling)
 *
 * Re-entrancy: each refresh is guarded by its own isRefreshing flag, so a slow
 * /payments fetch will never block a /metrics fetch (and vice versa).
 */

const PAYMENTS_INTERVAL_MS = 3000;
const METRICS_INTERVAL_MS = 5000;

export const usePollingStore = defineStore('polling', () => {
  const isPolling = ref(false);
  const isRefreshingPayments = ref(false);
  const isRefreshingMetrics = ref(false);
  const lastPaymentsRefreshAt = ref<Date | null>(null);
  const lastMetricsRefreshAt = ref<Date | null>(null);

  let paymentsTimer: ReturnType<typeof setInterval> | null = null;
  let metricsTimer: ReturnType<typeof setInterval> | null = null;

  async function refreshPayments() {
    if (isRefreshingPayments.value) return;
    const paymentsStore = usePaymentsStore();
    isRefreshingPayments.value = true;
    try {
      await paymentsStore.fetchList();
      lastPaymentsRefreshAt.value = new Date();
    } finally {
      isRefreshingPayments.value = false;
    }
  }

  async function refreshMetrics() {
    if (isRefreshingMetrics.value) return;
    const metricsStore = useMetricsStore();
    isRefreshingMetrics.value = true;
    try {
      await metricsStore.refresh();
      lastMetricsRefreshAt.value = new Date();
    } finally {
      isRefreshingMetrics.value = false;
    }
  }

  /** Fire one immediate refresh of BOTH stores without changing on/off state. */
  async function refreshNow() {
    await Promise.all([refreshPayments(), refreshMetrics()]);
  }

  function start() {
    if (isPolling.value) return;
    isPolling.value = true;
    // Fire immediately so UI populates without waiting for first tick
    void refreshPayments();
    void refreshMetrics();
    paymentsTimer = setInterval(() => void refreshPayments(), PAYMENTS_INTERVAL_MS);
    metricsTimer = setInterval(() => void refreshMetrics(), METRICS_INTERVAL_MS);
  }

  function stop() {
    isPolling.value = false;
    if (paymentsTimer) {
      clearInterval(paymentsTimer);
      paymentsTimer = null;
    }
    if (metricsTimer) {
      clearInterval(metricsTimer);
      metricsTimer = null;
    }
  }

  function toggle() {
    if (isPolling.value) stop();
    else start();
  }

  return {
    // state
    isPolling,
    isRefreshingPayments,
    isRefreshingMetrics,
    lastPaymentsRefreshAt,
    lastMetricsRefreshAt,
    // actions
    start,
    stop,
    toggle,
    refreshNow,
    refreshPayments,
    refreshMetrics,
  };
});
