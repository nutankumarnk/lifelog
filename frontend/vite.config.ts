import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const BACKEND_ORIGIN = process.env.LIFELOG_BACKEND_ORIGIN ?? 'http://127.0.0.1:4319';

/** Longer than the backend AI deadline so a slow Gemma reply is not cut off by the proxy. */
const PROXY_TIMEOUT_MS = 120_000;

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5319,
    strictPort: true,
    // The browser only ever talks to Vite. Vite forwards /api and /health to the
    // backend, so the test console never needs an API key or a database.
    proxy: {
      '/api': {
        target: BACKEND_ORIGIN,
        changeOrigin: true,
        timeout: PROXY_TIMEOUT_MS,
        proxyTimeout: PROXY_TIMEOUT_MS,
      },
      '/health': {
        target: BACKEND_ORIGIN,
        changeOrigin: true,
        timeout: PROXY_TIMEOUT_MS,
        proxyTimeout: PROXY_TIMEOUT_MS,
      },
    },
  },
  preview: { host: true, port: 5319, strictPort: true },
});
