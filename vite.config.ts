import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { atelierDevFs } from './scripts/vite-dev-fs';

// Port/host are fixed because Tauri's devUrl points here (src-tauri/tauri.conf.json).
export default defineConfig({
  plugins: [react(), atelierDevFs()],
  resolve: {
    alias: { '@core': fileURLToPath(new URL('./src/core', import.meta.url)) },
  },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true },
});
