import 'primeicons/primeicons.css';
import './styles.css';

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';

import App from './App.vue';
import router from './router';
import { useAuthStore } from './stores/auth.store';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: { darkModeSelector: '.app-dark' },
  },
});
app.use(ToastService);
app.use(ConfirmationService);

// Bootstrap: fetch the BFF session before mounting so the initial render knows
// whether the user is authenticated. We always mount (even on failure) — the
// auth store records `user = null` and the router guards (AUTH-21) decide
// whether to redirect to the BFF login page.
const auth = useAuthStore(pinia);
auth.fetchSession().finally(() => {
  app.mount('#app');
});
