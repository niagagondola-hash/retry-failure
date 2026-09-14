import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'home',
      component: () => import('../views/HomeView.vue'),
    },
    {
      path: '/payments',
      name: 'payments',
      component: () => import('../views/PaymentsView.vue'),
    },
    {
      path: '/payments/:id',
      name: 'payment-detail',
      component: () => import('../views/PaymentDetailView.vue'),
      props: true,
    },
    {
      path: '/metrics',
      name: 'metrics',
      component: () => import('../views/MetricsView.vue'),
    },
  ],
});

export default router;
