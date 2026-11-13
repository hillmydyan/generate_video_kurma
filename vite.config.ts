import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3001,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8006',
        changeOrigin: true,
      },
      '/videos': {
        target: 'http://127.0.0.1:8006',
        changeOrigin: true,
      },
      '/images': {
        target: 'http://127.0.0.1:8006',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://127.0.0.1:8006',
        changeOrigin: true,
      },
    },
  },
});

