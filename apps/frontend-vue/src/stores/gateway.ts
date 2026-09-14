import { defineStore } from 'pinia';
import { ref } from 'vue';
import * as gatewayApi from '../api/gateway';
import type { GatewayConfig, GatewayStats } from '../api/gateway';

export const useGatewayStore = defineStore('gateway', () => {
  const config = ref<GatewayConfig | null>(null);
  const stats = ref<GatewayStats | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function fetchConfig() {
    loading.value = true;
    error.value = null;
    try {
      config.value = await gatewayApi.getGatewayConfig();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  async function updateConfig(payload: Partial<GatewayConfig>) {
    loading.value = true;
    error.value = null;
    try {
      config.value = await gatewayApi.updateGatewayConfig(payload);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
      throw e;
    } finally {
      loading.value = false;
    }
  }

  async function fetchStats() {
    try {
      stats.value = await gatewayApi.getGatewayStats();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  return { config, stats, loading, error, fetchConfig, updateConfig, fetchStats };
});
