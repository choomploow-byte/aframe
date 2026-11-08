// Bundles the MCP server into ONE file, mcp/dist/aframe-mcp.mjs: ESM, Node 20+, no node_modules
// needed on the user's machine, shebang and a version header the app uses to decide whether to
// replace the copy in ~/.aframe/mcp. Also regenerates mcp/generated.ts (skills, instructions).
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { build } from 'esbuild';
import { ATTRIBUTION } from './attribution.mjs';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
execFileSync(process.execPath, [`${root}scripts/gen-mcp-data.mjs`], { stdio: 'inherit' });

const version = JSON.parse(readFileSync(`${root}package.json`, 'utf8')).version;
mkdirSync(`${root}mcp/dist`, { recursive: true });

await build({
  entryPoints: [`${root}mcp/entry.ts`],
  outfile: `${root}mcp/dist/aframe-mcp.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  alias: { '@core': `${root}src/core` },
  banner: {
    // `require` for the few CommonJS dependencies inside the bundle (ajv and friends).
    js: `#!/usr/bin/env node\n// aframe-mcp-version: ${version}\nimport { createRequire as __aframeCreateRequire } from 'node:module';\nconst require = __aframeCreateRequire(import.meta.url);`,
  },
  // At the end, so the version header on the first lines stays where the app looks for it.
  footer: { js: ATTRIBUTION },
  legalComments: 'none',
  logLevel: 'warning',
  minify: false,
});
chmodSync(`${root}mcp/dist/aframe-mcp.mjs`, 0o755);
const kb = Math.round(statSync(`${root}mcp/dist/aframe-mcp.mjs`).size / 1024);
console.log(`build-mcp: mcp/dist/aframe-mcp.mjs (${kb} KB, v${version})`);
