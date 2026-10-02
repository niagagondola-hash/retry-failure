<script setup lang="ts">
// Plan reference: PLAN2 Section 11.2 (Struktur folder — App.vue renders AppMenu).
// Task: AUTH-22 — render `<AppMenu />` in the sticky header. The header
// component owns brand + menu + user section + dark mode toggle (consolidated
// single-header decision — see worklog AUTH-22). App.vue keeps the bootstrap
// lifecycle (gateway config + global polling) + sticky footer + RouterView +
// Toast.

import { onUnmounted } from 'vue';
import { usePollingStore } from './stores/polling';
import AppMenu from './components/AppMenu.vue';

const pollingStore = usePollingStore();

onUnmounted(() => {
  // Cleanup timers (rarely fires in SPA, but good hygiene)
  pollingStore.stop();
});
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- Sticky header (brand + menu + user section + dark toggle) -->
    <AppMenu />

    <!-- Main Content -->
    <main class="flex-1">
      <RouterView />
    </main>

    <!-- Sticky Footer -->
    <footer class="mt-auto border-t bg-gray-50 dark:bg-gray-900 py-3">
      <div class="container mx-auto px-4 text-center text-xs text-gray-500">
        Cockatiel Retry Failure Demo - Payment Processing with Resilience
      </div>
    </footer>

    <Toast />
  </div>
</template>
