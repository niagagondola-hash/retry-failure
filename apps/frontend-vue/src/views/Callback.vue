<script setup lang="ts">
// Plan reference: PLAN2 Section 11.5 (Route guard) + AUTH-21 spec §4.
// Task: AUTH-21 — FE Vue auth pages.
//
// Single responsibility: handle the post-OAuth FE callback. The BFF
// `/auth/callback` endpoint already exchanged the code + set the `sid`
// cookie; this page only needs to (1) fetch the session into the Pinia store
// and (2) redirect to the `next` query (or `/`). On any failure we bounce
// back to `/login` (which itself redirects to the BFF `/auth/login`).

import { onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.store';

// File name is intentionally single-word per AUTH-21 spec §4 — give the
// component a multi-word registered name so `vue/multi-word-component-names`
// is satisfied (registered name takes precedence over filename).
defineOptions({ name: 'CallbackPage' });

/** Default route after a successful callback when no `next` query is set. */
const DEFAULT_NEXT_ROUTE = '/';

/** Time (ms) before redirecting back to `/login` on failure — gives the
 *  error message a chance to be read before the page navigates away. */
const FAILURE_REDIRECT_DELAY_MS = 2000;

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const loading = ref<boolean>(true);
const errorMessage = ref<string | null>(null);

onMounted(async () => {
  console.debug('[callback] post-OAuth callback received, fetchSession start');
  try {
    await auth.fetchSession();
    if (!auth.user) {
      console.warn('[callback] fetchSession returned no user, redirect to /login');
      errorMessage.value = 'Login failed. Session not established.';
      window.setTimeout(() => {
        void router.push({ name: 'login' });
      }, FAILURE_REDIRECT_DELAY_MS);
      return;
    }
    const nextQuery = route.query.next;
    const next = typeof nextQuery === 'string' && nextQuery.length > 0 ? nextQuery : DEFAULT_NEXT_ROUTE;
    console.info('[callback] session established, redirect to:', next);
    await router.push(next);
  } catch (err: unknown) {
    console.error('[callback] error during fetchSession, redirect to /login:', err);
    errorMessage.value = extractMessage(err, 'Login failed.');
    window.setTimeout(() => {
      void router.push({ name: 'login' });
    }, FAILURE_REDIRECT_DELAY_MS);
  } finally {
    loading.value = false;
  }
});

/** Best-effort message extraction — falls back to `fallback`. */
function extractMessage(err: unknown, fallback: string): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'object' && err !== null && 'message' in err) {
    const message = (err as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return fallback;
}
</script>

<template>
  <div class="callback-page flex flex-col items-center justify-center min-h-[50vh] gap-4 p-8">
    <template v-if="loading">
      <ProgressSpinner />
      <p class="text-gray-600 dark:text-gray-300">
        Completing login...
      </p>
    </template>
    <template v-else-if="errorMessage">
      <p class="text-red-600 dark:text-red-400 font-medium">
        {{ errorMessage }}
      </p>
      <p class="text-sm text-gray-500 dark:text-gray-400">
        Redirecting you to login...
      </p>
    </template>
  </div>
</template>
