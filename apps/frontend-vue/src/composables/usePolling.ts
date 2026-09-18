import { ref, onUnmounted } from 'vue';

export function usePolling(fn: () => Promise<void>, intervalMs: number) {
  const isPolling = ref(false);
  let timer: ReturnType<typeof setInterval> | null = null;

  function start() {
    if (isPolling.value) return;
    isPolling.value = true;
    fn();
    timer = setInterval(() => fn(), intervalMs);
  }

  function stop() {
    isPolling.value = false;
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  onUnmounted(() => stop());

  return { isPolling, start, stop };
}
