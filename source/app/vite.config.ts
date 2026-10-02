import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: '.',
  build: {
    outDir: '../../build/frontend',
    emptyOutDir: true,
    rollupOptions: { input: ['index.html', 'hud.html'] },
  },
  base: './',
  server: {
    proxy: {
      '/api': {
        // Keep development separate from the packaged desktop daemon on 3456.
        // Otherwise its SPA fallback returns HTML for new API routes and breaks
        // detail views that expect JSON.
        target: 'http://127.0.0.1:3457',
        changeOrigin: true,
      },
    },
  },
});
