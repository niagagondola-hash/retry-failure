import { ref, onUnmounted } from 'vue';

/**
 * Generic polling composable.
 *
 * Usage:
 *   const { isPolling, start, stop, toggle, refreshNow } = usePolling(async () => {
 *     await store.fetchList();
 *   }, 3000);
 *
 * - start(): begin polling (also fires immediately)
 * - stop(): stop polling
 * - toggle(): flip on/off
 * - refreshNow(): fire one immediate poll without changing on/off state
 */
export function usePolling(fn: () => Promise<void>, intervalMs: number) {
  const isPolling = ref(false);
  const isRefreshing = ref(false);
  const lastRefreshedAt = ref<Date | null>(null);
  let timer: ReturnType<typeof setInterval> | null = null;

  function start() {
    if (isPolling.value) return;
    isPolling.value = true;
    void refreshNow();
    timer = setInterval(() => void refreshNow(), intervalMs);
  }

  function stop() {
    isPolling.value = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  function toggle() {
    if (isPolling.value) {
      stop();
    } else {
      start();
    }
  }

  /** Fire one immediate poll without changing on/off state. */
  async function refreshNow() {
    if (isRefreshing.value) return;
    isRefreshing.value = true;
    try {
      await fn();
      lastRefreshedAt.value = new Date();
    } finally {
      isRefreshing.value = false;
    }
  }

  onUnmounted(() => stop());

  return { isPolling, isRefreshing, lastRefreshedAt, start, stop, toggle, refreshNow };
}
