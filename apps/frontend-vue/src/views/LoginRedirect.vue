<script setup lang="ts">
// Plan reference: PLAN2 Section 11.5 (Route guard) + AUTH-21 spec §3.
// Task: AUTH-21 — FE Vue auth pages.
//
// Single responsibility: render a spinner + "Redirecting to login..." copy
// while the SPA bounces the browser to the BFF `/auth/login` endpoint so the
// BFF can start the OAuth/PKCE flow. The 300ms delay is intentional UX — a
// zero-delay `window.location.href = ...` would never paint the spinner.

import { onMounted } from 'vue';

/** BFF login URL — same as `router/guards.ts` `BFF_LOGIN_HREF`. */
const BFF_LOGIN_HREF: string = `${import.meta.env.VITE_API_URL ?? 'http://localhost:3001'}/auth/login`;

/** Spinner visible-time before the full-page redirect fires. */
const REDIRECT_DELAY_MS = 300;

onMounted(() => {
  setTimeout(() => {
    window.location.href = BFF_LOGIN_HREF;
  }, REDIRECT_DELAY_MS);
});
</script>

<template>
  <div class="login-redirect-page flex flex-col items-center justify-center min-h-[50vh] gap-4 p-8">
    <ProgressSpinner />
    <p class="text-gray-600 dark:text-gray-300">
      Redirecting to login...
    </p>
  </div>
</template>
