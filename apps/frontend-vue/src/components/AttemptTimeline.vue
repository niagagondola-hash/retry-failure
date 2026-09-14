<script setup lang="ts">
import type { AttemptView } from '../api/payments';

defineProps<{ attempts: AttemptView[] }>();

function severity(outcome: string): string {
  const map: Record<string, string> = {
    success: 'success',
    retryable_failure: 'warn',
    permanent_failure: 'danger',
    timeout: 'warn',
    circuit_open: 'danger',
  };
  return map[outcome] ?? 'info';
}
</script>

<template>
  <div v-if="attempts.length === 0" class="text-gray-500 p-4">No attempts recorded.</div>
  <Timeline v-else :value="attempts">
    <template #opposite="slotProps">
      <small class="text-gray-500">Attempt #{{ slotProps.item.attemptNumber }}</small>
    </template>
    <template #content="slotProps">
      <div class="flex flex-col gap-1 p-2">
        <div class="flex items-center gap-2">
          <Tag :severity="severity(slotProps.item.outcome)" :value="slotProps.item.outcome" />
          <span v-if="slotProps.item.httpStatus" class="text-sm">HTTP {{ slotProps.item.httpStatus }}</span>
        </div>
        <div v-if="slotProps.item.errorCode" class="text-xs text-red-500">
          {{ slotProps.item.errorCode }}: {{ slotProps.item.errorMessage }}
        </div>
        <div class="text-xs text-gray-500">
          Duration: {{ slotProps.item.durationMs }}ms | Breaker: {{ slotProps.item.breakerState }}
          <span v-if="slotProps.item.replayed"> | REPLAYED</span>
        </div>
        <div v-if="slotProps.item.traceId" class="text-xs text-gray-400 font-mono">
          trace: {{ slotProps.item.traceId.substring(0, 8) }}...
        </div>
      </div>
    </template>
  </Timeline>
</template>
