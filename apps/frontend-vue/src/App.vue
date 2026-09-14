<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const isDark = ref(false);

function toggleDark() {
  isDark.value = !isDark.value;
  document.documentElement.classList.toggle('app-dark', isDark.value);
}
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- Sticky Header -->
    <header class="border-b sticky top-0 z-50 bg-white dark:bg-gray-900">
      <div class="container mx-auto px-4 py-3 flex items-center justify-between">
        <div class="flex items-center gap-4">
          <h1 class="text-lg font-bold cursor-pointer" @click="router.push('/')">
            Cockatiel Retry Dashboard
          </h1>
          <nav class="flex gap-3">
            <RouterLink to="/" class="text-sm hover:text-blue-500">Home</RouterLink>
            <RouterLink to="/payments" class="text-sm hover:text-blue-500">Payments</RouterLink>
            <RouterLink to="/metrics" class="text-sm hover:text-blue-500">Metrics</RouterLink>
          </nav>
        </div>
        <Button
          :icon="isDark ? 'pi pi-sun' : 'pi pi-moon'"
          severity="secondary"
          text
          @click="toggleDark"
        />
      </div>
    </header>

    <!-- Main Content -->
    <main class="flex-1">
      <RouterView />
    </main>

    <!-- Sticky Footer -->
    <footer class="mt-auto border-t bg-gray-50 dark:bg-gray-900 py-3">
      <div class="container mx-auto px-4 text-center text-xs text-gray-500">
        Cockatiel Retry Failure Demo — Payment Processing with Resilience
      </div>
    </footer>

    <Toast />
  </div>
</template>
