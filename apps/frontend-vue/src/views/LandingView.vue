<script setup lang="ts">
// Plan reference: PLAN2 Section 11.2 (Struktur folder), AUTH-09a (landing page).
//
// Single responsibility: render landing page untuk user yang belum login
// (atau sudah login tapi visit root /).
//
// Conditional render:
//   - Not authenticated → "Login" button (redirect ke BFF /auth/login)
//   - Authenticated → "Go to Dashboard" button (router.push /dashboard)

import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.store';
import { onMounted } from 'vue';

const router = useRouter();
const auth = useAuthStore();

/** BFF login URL — full-page redirect starts OAuth/PKCE flow. */
const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const LOGIN_HREF = `${API_URL}/auth/login`;

function handleLogin(): void {
  // Full-page redirect to BFF /auth/login — starts OAuth/PKCE flow.
  window.location.href = LOGIN_HREF;
}

function goDashboard(): void {
  router.push('/dashboard');
}

onMounted(async () => {
  auth.fetchSession();
})
</script>

<template>
  <div class="landing-page">
    <Card>
      <template #title>
        <div class="header">
          <i class="pi pi-shield" />
          <span>Payment System</span>
        </div>
      </template>
      <template #content>
        <p>Cockatiel Retry-Failure Demo — Payment Processing with Resilience.</p>
        <p class="subtitle">
          OAuth2 + PKCE + BFF pattern + Cockatiel resilience policies.
        </p>

        <!-- Not authenticated → Login button -->
        <div
          v-if="!auth.isAuthenticated"
          class="actions"
        >
          <Button
            label="Login"
            icon="pi pi-sign-in"
            size="large"
            @click="handleLogin"
          />
        </div>

        <!-- Already authenticated → Go to Dashboard -->
        <div
          v-else
          class="actions"
        >
          <p>Welcome back, {{ auth.user?.username }}!</p>
          <Button
            label="Go to Dashboard"
            icon="pi pi-home"
            size="large"
            @click="goDashboard"
          />
        </div>
      </template>
    </Card>
  </div>
</template>

<style scoped>
.landing-page {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 60vh;
  padding: 2rem;
}
.header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.header i {
  font-size: 1.5rem;
  color: var(--p-primary-color, #2563eb);
}
.subtitle {
  color: var(--p-text-secondary-color, #6b7280);
  font-size: 0.9rem;
  margin-bottom: 1.5rem;
}
.actions {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  margin-top: 1rem;
}
</style>
