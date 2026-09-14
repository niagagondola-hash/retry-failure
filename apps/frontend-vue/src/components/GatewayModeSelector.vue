<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useGatewayStore } from '../stores/gateway';
import { useToast } from 'primevue/usetoast';

const gatewayStore = useGatewayStore();
const toast = useToast();

const modes = [
  'always-success', 'fail-first-n', 'server-error', 'always-timeout',
  'client-error', 'random', 'succeed-but-drop-response', 'rate-limited',
];

const localConfig = ref({
  mode: 'always-success',
  n: 2,
  probability: 0.5,
  retryAfterSeconds: 10,
  timeoutMs: 5000,
});

onMounted(async () => {
  await gatewayStore.fetchConfig();
  if (gatewayStore.config) {
    localConfig.value = { ...gatewayStore.config };
  }
});

async function save() {
  try {
    await gatewayStore.updateConfig(localConfig.value);
    toast.add({ severity: 'success', summary: 'Gateway mode updated', life: 2000 });
  } catch {
    toast.add({ severity: 'error', summary: 'Failed to update gateway', life: 3000 });
  }
}
</script>

<template>
  <Card>
    <template #title>Gateway Mode Selector</template>
    <template #content>
      <div class="flex flex-col gap-3">
        <div class="flex items-center gap-2">
          <label class="w-32">Mode:</label>
          <Select v-model="localConfig.mode" :options="modes" class="flex-1" />
        </div>

        <div v-if="localConfig.mode === 'fail-first-n'" class="flex items-center gap-2">
          <label class="w-32">N (fail count):</label>
          <InputNumber v-model="localConfig.n" :min="0" :max="100" class="flex-1" />
        </div>

        <div v-if="localConfig.mode === 'random'" class="flex items-center gap-2">
          <label class="w-32">Probability:</label>
          <InputNumber v-model="localConfig.probability" :min="0" :max="1" :step="0.1" class="flex-1" />
        </div>

        <div v-if="localConfig.mode === 'rate-limited'" class="flex items-center gap-2">
          <label class="w-32">Retry-After (s):</label>
          <InputNumber v-model="localConfig.retryAfterSeconds" :min="0" :max="86400" class="flex-1" />
        </div>

        <div v-if="localConfig.mode === 'always-timeout'" class="flex items-center gap-2">
          <label class="w-32">Timeout (ms):</label>
          <InputNumber v-model="localConfig.timeoutMs" :min="0" :max="60000" class="flex-1" />
        </div>

        <Button label="Save" icon="pi pi-check" @click="save" :loading="gatewayStore.loading" />
      </div>
    </template>
  </Card>
</template>
