import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { resolveApiProxyTarget } from './vite-api-proxy';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: resolveApiProxyTarget(),
        changeOrigin: true,
      },
    },
  },
});
