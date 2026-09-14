<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ status: string }>();

const severity = computed(() => {
  const map: Record<string, string> = {
    succeeded: 'success',
    failed: 'danger',
    processing: 'info',
    scheduled_for_retry: 'warn',
  };
  return map[props.status] ?? 'secondary';
});
</script>

<template>
  <Tag
    :severity="severity"
    :value="status"
  />
</template>
