import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@core': fileURLToPath(new URL('./src/core', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: [
      'src/**/*.test.ts',
      'tests/unit/**/*.test.ts',
      'tests/node/**/*.test.ts',
      'tests/mcp/**/*.test.ts',
    ],
    // Builds mcp/dist/aframe-mcp.mjs once: the integration tests run the file that ships.
    globalSetup: ['tests/mcp/global-setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts'],
      // testing.ts is a test helper; index.ts only re-exports.
      exclude: ['src/core/**/*.test.ts', 'src/core/testing.ts', 'src/core/index.ts'],
      reporter: ['text', 'html'],
      thresholds: {
        // Phase 1 acceptance (docs/12): >= 90% line coverage on these four.
        'src/core/ops.ts': { lines: 90 },
        'src/core/apply.ts': { lines: 90 },
        'src/core/style.ts': { lines: 90 },
        'src/core/tokens.ts': { lines: 90 },
        // The rest of core is held to a lower floor so it cannot silently rot.
        'src/core/**/*.ts': { lines: 85 },
      },
    },
  },
});
