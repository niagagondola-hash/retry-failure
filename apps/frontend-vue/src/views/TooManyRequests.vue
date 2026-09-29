<script setup lang="ts">
// Plan reference: PLAN2 Section 11.3 (Aturan — 429 redirect) + AUTH-21 spec §6.
// Task: AUTH-21 — FE Vue auth pages.
//
// Single responsibility: render the 429 Too Many Requests page with a
// countdown read from the `retryAfter` query (populated by the axios
// response interceptor from the BE `Retry-After` header). The "Retry" button
// is disabled until the countdown reaches zero, then sends the user back to
// the `from` query (or `/`).

import { computed, onMounted, onUnmounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

/** Default countdown (seconds) when no `retryAfter` query is present. */
const DEFAULT_RETRY_AFTER_SEC = 60;

/** Countdown tick interval (ms). */
const TICK_MS = 1000;

const route = useRoute();
const router = useRouter();

const retryAfterSec = ref<number>(0);
const from = computed<string>(() => asString(route.query.from) ?? '/');

let timer: ReturnType<typeof setInterval> | undefined;

onMounted(() => {
  retryAfterSec.value = clampRetryAfter(asString(route.query.retryAfter));
  timer = setInterval(() => {
    if (retryAfterSec.value > 0) {
      retryAfterSec.value -= 1;
    } else if (timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  }, TICK_MS);
});

onUnmounted(() => {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
});

function retry(): void {
  void router.push(from.value);
}

function goDashboard(): void {
  void router.push('/');
}

/** Coerce a query param (string | string[] | undefined) to a single string. */
function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

/** Parse the `retryAfter` query into a positive integer (default 60s). */
function clampRetryAfter(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_RETRY_AFTER_SEC;
  const parsed = Number.parseInt(raw, 10);
  if (Number.isNaN(parsed) || parsed < 0) return DEFAULT_RETRY_AFTER_SEC;
  return parsed;
}
</script>

<template>
  <div class="too-many-requests-page flex justify-center items-center min-h-[70vh] p-8">
    <Card class="w-full max-w-lg">
      <template #title>
        <div class="header flex items-center gap-2">
          <i class="pi pi-clock text-amber-500" />
          <span>Too Many Requests</span>
        </div>
      </template>
      <template #content>
        <p class="text-gray-700 dark:text-gray-300">
          You've made too many requests. Please wait and try again.
        </p>
        <div class="countdown my-4">
          <small
            v-if="retryAfterSec > 0"
            class="text-gray-600 dark:text-gray-400"
          >Retry in {{ retryAfterSec }} seconds...</small>
          <small
            v-else
            class="text-green-600 dark:text-green-400"
          >You can retry now.</small>
        </div>
        <div class="actions flex gap-2">
          <Button
            label="Retry"
            icon="pi pi-refresh"
            :disabled="retryAfterSec > 0"
            @click="retry"
          />
          <Button
            label="Back to Dashboard"
            icon="pi pi-home"
            severity="secondary"
            @click="goDashboard"
          />
        </div>
      </template>
    </Card>
  </div>
</template>
