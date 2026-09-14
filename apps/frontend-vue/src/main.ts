import 'primeicons/primeicons.css';
import './styles.css';

import { createApp } from 'vue';
import { createPinia } from 'pinia';
import PrimeVue from 'primevue/config';
import Aura from '@primevue/themes/aura';
import ToastService from 'primevue/toastservice';
import ConfirmationService from 'primevue/confirmationservice';

// PrimeVue components — global registration
import Card from 'primevue/card';
import Button from 'primevue/button';
import InputText from 'primevue/inputtext';
import InputNumber from 'primevue/inputnumber';
import Select from 'primevue/select';
import DataTable from 'primevue/datatable';
import Column from 'primevue/column';
import Tag from 'primevue/tag';
import Dialog from 'primevue/dialog';
import Toast from 'primevue/toast';
import Timeline from 'primevue/timeline';
import Chart from 'primevue/chart';
import Textarea from 'primevue/textarea';
import ProgressSpinner from 'primevue/progressspinner';

import App from './App.vue';
import router from './router';

const app = createApp(App);

app.use(createPinia());
app.use(router);
app.use(PrimeVue, {
  theme: {
    preset: Aura,
    options: { darkModeSelector: '.app-dark' },
  },
});
app.use(ToastService);
app.use(ConfirmationService);

// Register all PrimeVue components globally
app.component('Card', Card);
app.component('Button', Button);
app.component('InputText', InputText);
app.component('InputNumber', InputNumber);
app.component('Select', Select);
app.component('DataTable', DataTable);
app.component('Column', Column);
app.component('Tag', Tag);
app.component('Dialog', Dialog);
app.component('Toast', Toast);
app.component('Timeline', Timeline);
app.component('Chart', Chart);
app.component('Textarea', Textarea);
app.component('ProgressSpinner', ProgressSpinner);

app.mount('#app');
