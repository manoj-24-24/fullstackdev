import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      // PWA identity files must always be revalidated, or browsers keep showing
      // a stale app icon after the icons/manifest change on disk.
      name: 'pwa-no-cache',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (/^\/(manifest\.webmanifest|sw\.js|icon-.*\.png|apple-touch-icon\.png|favicon\.png)/.test(req.url || '')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
          next();
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          if (/^\/(manifest\.webmanifest|sw\.js|icon-.*\.png|apple-touch-icon\.png|favicon\.png)/.test(req.url || '')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
          next();
        });
      },
    },
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    port: 5173,
    proxy: {
      // Forward API + file uploads to the local MySQL backend (server/index.js).
      '/api': 'http://localhost:3001',
      '/uploads': 'http://localhost:3001',
    },
  },
});