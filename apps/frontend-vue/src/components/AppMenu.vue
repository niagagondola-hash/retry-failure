<script setup lang="ts">
// Plan reference: PLAN2 Section 11.2 (Struktur folder — components/AppMenu.vue),
// Section 11.3 (Aturan), Section 6.1 (Menu code), Section 6.2 (Mapping endpoint → menu).
// Task: AUTH-22 — FE Vue menu component.
//
// Single responsibility: render the top navigation bar.
// - Menu items come from `useMenuStore().menuModel` (already filtered by
//   permission + shaped for PrimeVue).
// - User section (login/logout + username) reads `useAuthStore()` directly.
// - Dark mode toggle is consolidated here so the header has a single owner
//   component (decision documented in worklog AUTH-22).

import { ref } from 'vue';
import { useRouter } from 'vue-router';
import Menubar from 'primevue/menubar';
import Button from 'primevue/button';
import { useAuthStore } from '../stores/auth.store';
import { useMenuStore } from '../stores/menu.store';

const router = useRouter();
const auth = useAuthStore();
const menu = useMenuStore();

/** Brand label shown in the `#start` slot. */
const BRAND_LABEL = 'Payment System';

/** Toggle dark theme by flipping the `.app-dark` class on `<html>`. */
const isDark = ref(false);

function handleBrandClick(): void {
  void router.push('/');
}

function handleLogin(): void {
  // FE LoginRedirect.vue (AUTH-21) renders a spinner then bounces to the BFF
  // `/auth/login` URL — better UX than a hard `window.location.href` jump.
  void router.push('/login');
}

async function handleLogout(): Promise<void> {
  // `auth.logout()` calls the BFF, clears local state, and finally redirects
  // the browser to the BFF login page (full reload). Failures are swallowed
  // inside the store so the user always reaches the login page.
  await auth.logout();
}

function toggleDark(): void {
  isDark.value = !isDark.value;
  document.documentElement.classList.toggle('app-dark', isDark.value);
}
</script>

<template>
  <header class="border-b sticky top-0 z-50 bg-white dark:bg-gray-900">
    <div class="container mx-auto px-4">
      <Menubar :model="menu.menuModel">
        <template #start>
          <span
            class="text-lg font-bold cursor-pointer select-none mr-4"
            data-testid="app-menu-brand"
            @click="handleBrandClick"
          >
            {{ BRAND_LABEL }}
          </span>
        </template>

        <template #end>
          <div class="flex items-center gap-2">
            <Button
              :icon="isDark ? 'pi pi-sun' : 'pi pi-moon'"
              severity="secondary"
              text
              aria-label="Toggle dark mode"
              data-testid="app-menu-dark-toggle"
              @click="toggleDark"
            />

            <div
              v-if="auth.isAuthenticated"
              class="flex items-center gap-2"
            >
              <span
                class="text-sm font-medium"
                data-testid="app-menu-username"
              >
                {{ auth.user?.username }}
              </span>
              <Button
                icon="pi pi-sign-out"
                label="Logout"
                severity="secondary"
                text
                data-testid="app-menu-logout"
                @click="handleLogout"
              />
            </div>

            <Button
              v-else
              icon="pi pi-sign-in"
              label="Login"
              severity="secondary"
              text
              data-testid="app-menu-login"
              @click="handleLogin"
            />
          </div>
        </template>
      </Menubar>
    </div>
  </header>
</template>

<style scoped>
:deep(.menu-item-active) {
  background-color: #eff6ff;
  color: #2563eb;
  font-weight: 600;
}
</style>
