<script setup lang="ts">
// Plan reference: PLAN2 Section 11.3 (Aturan — 403 redirect) + AUTH-21 spec §5.
// Task: AUTH-21 — FE Vue auth pages.
//
// Single responsibility: render the 403 Forbidden page. Reached either from
// the router guard (`meta.menu` denied) or from the axios response
// interceptor (BE returned 403). The page surfaces the `from` + `menu` query
// params so the user can see which permission was missing and where they
// tried to go.

import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.store';

// File name is intentionally single-word per AUTH-21 spec §5 — give the
// component a multi-word registered name so `vue/multi-word-component-names`
// is satisfied (registered name takes precedence over filename).
defineOptions({ name: 'ForbiddenPage' });

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();

const from = computed<string | undefined>(() => asString(route.query.from));
const menu = computed<string | undefined>(() => asString(route.query.menu));

function goDashboard(): void {
  void router.push('/');
}

async function logout(): Promise<void> {
  await auth.logout();
}

/** Coerce a query param (string | string[] | undefined) to a single string. */
function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}
</script>

<template>
  <div class="forbidden-page flex justify-center items-center min-h-[70vh] p-8">
    <Card class="w-full max-w-lg">
      <template #title>
        <div class="header flex items-center gap-2">
          <i class="pi pi-exclamation-triangle text-red-600" />
          <span>Access Denied</span>
        </div>
      </template>
      <template #content>
        <p class="text-gray-700 dark:text-gray-300">
          You don't have permission to access this page.
        </p>
        <div
          v-if="menu"
          class="mt-3 text-sm"
        >
          Required permission:
          <code class="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{{ menu }}</code>
        </div>
        <div
          v-if="from"
          class="mt-1 text-sm"
        >
          Attempted to access:
          <code class="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800">{{ from }}</code>
        </div>
        <div class="actions flex gap-2 mt-4">
          <Button
            label="Back to Dashboard"
            icon="pi pi-home"
            @click="goDashboard"
          />
          <Button
            label="Logout"
            icon="pi pi-sign-out"
            severity="secondary"
            @click="logout"
          />
        </div>
      </template>
    </Card>
  </div>
</template>
