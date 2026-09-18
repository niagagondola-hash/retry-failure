import axios from 'axios';

const baseURL = import.meta.env.VITE_PAYMENT_API_URL ?? 'http://localhost:3001';

export const apiClient = axios.create({
  baseURL,
  // 30s to accommodate demo scenarios that involve many retries with delays
  // (e.g., Demo E rate-limited: 4 attempts × 3s Retry-After = ~12s)
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    console.error('[API Error]', error.config?.method?.toUpperCase(), error.config?.url, error.response?.status, error.message);
    return Promise.reject(error);
  },
);

export const gatewayClient = axios.create({
  baseURL: import.meta.env.VITE_GATEWAY_MOCK_URL ?? 'http://localhost:3002',
  timeout: 5000,
  headers: { 'Content-Type': 'application/json' },
});
