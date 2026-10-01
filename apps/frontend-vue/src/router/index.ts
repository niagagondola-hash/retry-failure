// Plan reference: PLAN2 Section 11.5 (Route guard), Section 11.2 (Struktur
// folder + views), Section 11.3 (Aturan — 401/403/429 redirect).
// Task: AUTH-21 — FE Vue router guards + auth pages.
//
// Single responsibility: declare the Vue Router configuration for the SPA —
// the 4 public auth pages (`/login`, `/callback`, `/forbidden`,
// `/too-many-requests`), the protected app routes (Home/Payments/Metrics),
// per-route `meta.menu` for permission gating, and registration of the
// global `beforeEach` guard (delegated to `guards.ts`).

import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router';
import { setupRouterGuards } from './guards';

/**
 * Route table. Order matters: more specific paths (e.g. `/payments/create`)
 * would need to come BEFORE `/payments/:id` to avoid shadowing — but the
 * SPA currently does not have a `/payments/create` route, so the simple list
 * below is sufficient.
 *
 * `meta.public` lets the guard (see `guards.ts`) skip session bootstrap for
 * auth-flow pages. `meta.menu` is the permission code checked against
 * `useAuthStore.hasMenu(code)` — see AUTH-20 for the store contract.
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginRedirect.vue'),
    meta: { public: true },
  },
  {
    path: '/callback',
    name: 'callback',
    component: () => import('../views/Callback.vue'),
    meta: { public: true },
  },
  {
    path: '/forbidden',
    name: 'forbidden',
    component: () => import('../views/Forbidden.vue'),
    meta: { public: true },
  },
  {
    path: '/too-many-requests',
    name: 'too-many-requests',
    component: () => import('../views/TooManyRequests.vue'),
    meta: { public: true },
  },

  // --- Protected routes — guard enforces session + meta.menu ---
  {
    path: '/',
    name: 'home',
    component: () => import('../views/HomeView.vue'),
    meta: { menu: 'dashboard' },
  },
  {
    path: '/payments',
    name: 'payments',
    component: () => import('../views/PaymentsView.vue'),
    meta: { menu: 'payment.read' },
  },
  {
    path: '/payments/:id',
    name: 'payment-detail',
    component: () => import('../views/PaymentDetailView.vue'),
    props: true,
    meta: { menu: 'payment.read' },
  },
  {
    path: '/metrics',
    name: 'metrics',
    component: () => import('../views/MetricsView.vue'),
    meta: { menu: 'dashboard' },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Register the global navigation guard (plan2 §11.5).
setupRouterGuards(router);

export default router;
