import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// clai dashboard: built to `dist/` and served same-origin under `/` by either
// `clai dashboard` (local CLI server) or `clai-server` (team server), both of
// which expose the JSON API under `/api`. `base: './'` keeps asset URLs relative
// so the bundle works when served from a non-root path too.
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4321',
        changeOrigin: true,
      },
    },
  },
});
