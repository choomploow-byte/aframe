import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { ATTRIBUTION } from './scripts/attribution.mjs';
import { atelierDevFs } from './scripts/vite-dev-fs';

const version = (JSON.parse(readFileSync('./package.json', 'utf8')) as { version: string }).version;

/** Minification removes comments, so the icon set's CC BY attribution is appended afterwards. */
const attribution = (): Plugin => ({
  name: 'atelier-attribution',
  apply: 'build',
  generateBundle(_options, bundle) {
    for (const file of Object.values(bundle)) {
      if (file.type === 'chunk' && file.isEntry) file.code += `\n${ATTRIBUTION}\n`;
    }
  },
});

// Port/host are fixed because Tauri's devUrl points here (src-tauri/tauri.conf.json).
export default defineConfig({
  plugins: [react(), atelierDevFs(), attribution()],
  define: { __APP_VERSION__: JSON.stringify(version) },
  resolve: {
    alias: { '@core': fileURLToPath(new URL('./src/core', import.meta.url)) },
  },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true },
});
