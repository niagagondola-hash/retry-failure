import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchMetricsRaw, parsePrometheusText } from '../api/metrics';
import type { ParsedMetrics } from '../api/metrics';

export const useMetricsStore = defineStore('metrics', () => {
  const raw = ref<string>('');
  const parsed = ref<ParsedMetrics | null>(null);
  const lastUpdated = ref<Date | null>(null);
  const loading = ref(false);

  async function refresh() {
    loading.value = true;
    try {
      // Single GET /metrics — parse locally to avoid duplicate HTTP request.
      // (Previously Promise.all([fetchMetricsRaw(), fetchMetrics()])
      //  triggered 2 identical /metrics calls because fetchMetrics()
      //  internally calls fetchMetricsRaw() again.)
      const rawText = await fetchMetricsRaw();
      raw.value = rawText;
      parsed.value = parsePrometheusText(rawText);
      lastUpdated.value = new Date();
    } catch (e) {
      console.error('[metrics] fetch failed:', e);
    } finally {
      loading.value = false;
    }
  }

  return { raw, parsed, lastUpdated, loading, refresh };
});
