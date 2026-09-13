<script setup lang="ts">
// Placeholder — full dashboard built in TASK-13.
</script>

<template>
  <div class="placeholder">
    <h1>Retry Failure — Vue Dashboard (PrimeVue)</h1>
    <p>
      This is a placeholder Vue app. Full dashboard will be built in
      <strong>TASK-13</strong> (Vue 3 + PrimeVue + Pinia + Vue Router).
    </p>
    <p>
      Backend API: <code>{{ backendApiUrl }}</code>
    </p>
  </div>
</template>

<script lang="ts">
export default {
  data() {
    return {
      backendApiUrl: import.meta.env.VITE_PAYMENT_API_URL ?? 'http://localhost:3001',
    };
  },
};
</script>

<style scoped>
.placeholder {
  font-family: system-ui, -apple-system, sans-serif;
  padding: 2rem;
  max-width: 720px;
  margin: 0 auto;
}
.placeholder code {
  background: #f3f4f6;
  padding: 0.1rem 0.4rem;
  border-radius: 4px;
  font-family: ui-monospace, monospace;
}
</style>
