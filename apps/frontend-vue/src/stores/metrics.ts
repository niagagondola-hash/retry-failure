import { defineStore } from 'pinia';
import { ref } from 'vue';
import { fetchMetrics, fetchMetricsRaw } from '../api/metrics';
import type { ParsedMetrics } from '../api/metrics';

export const useMetricsStore = defineStore('metrics', () => {
  const raw = ref<string>('');
  const parsed = ref<ParsedMetrics | null>(null);
  const lastUpdated = ref<Date | null>(null);
  const loading = ref(false);

  async function refresh() {
    loading.value = true;
    try {
      const [rawText, parsedData] = await Promise.all([fetchMetricsRaw(), fetchMetrics()]);
      raw.value = rawText;
      parsed.value = parsedData;
      lastUpdated.value = new Date();
    } catch (e) {
      console.error('[metrics] fetch failed:', e);
    } finally {
      loading.value = false;
    }
  }

  return { raw, parsed, lastUpdated, loading, refresh };
});
