/// <reference types="vitest" />
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';

/** Inyecta en dist/sw.js la versión del build y la lista de recursos a precachear. */
function serviceWorker(): Plugin {
  let salida = 'dist';
  const archivos: string[] = [];
  return {
    name: 'aquaplants-sw',
    apply: 'build',
    configResolved(c) {
      salida = c.build.outDir;
    },
    generateBundle(_o, bundle) {
      for (const f of Object.keys(bundle)) if (/\.(js|css|woff2)$/.test(f)) archivos.push(`/${f}`);
    },
    closeBundle() {
      const sw = path.resolve(salida, 'sw.js');
      if (!existsSync(sw)) return;
      const precache = ['/', '/index.html', '/offline.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', ...archivos.filter((a) => !a.endsWith('.woff2') || /latin-(400|500|600)-normal/.test(a))];
      writeFileSync(sw, readFileSync(sw, 'utf8').replace('__VERSION__', Date.now().toString(36)).replace('__PRECACHE__', JSON.stringify(precache)));
    },
  };
}

// En desarrollo, /api se envía a la API local: mismo origen para el navegador
// (también desde un teléfono en la red local con `npm run dev:web`).
export default defineConfig({
  plugins: [react(), serviceWorker()],
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:3000', changeOrigin: false } },
  },
  preview: {
    port: 4173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:3000', changeOrigin: false } },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: { output: { manualChunks: { graficos: ['chart.js', 'react-chartjs-2', 'chartjs-adapter-date-fns'] } } },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'] },
});
