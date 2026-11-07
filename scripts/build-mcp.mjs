// Bundles the MCP server into ONE file, mcp/dist/atelier-mcp.mjs: ESM, Node 20+, no node_modules
// needed on the user's machine, shebang and a version header the app uses to decide whether to
// replace the copy in ~/.atelier/mcp. Also regenerates mcp/generated.ts (skills, instructions).
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { build } from 'esbuild';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
execFileSync(process.execPath, [`${root}scripts/gen-mcp-data.mjs`], { stdio: 'inherit' });

const version = JSON.parse(readFileSync(`${root}package.json`, 'utf8')).version;
mkdirSync(`${root}mcp/dist`, { recursive: true });

await build({
  entryPoints: [`${root}mcp/entry.ts`],
  outfile: `${root}mcp/dist/atelier-mcp.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  alias: { '@core': `${root}src/core` },
  banner: {
    // `require` for the few CommonJS dependencies inside the bundle (ajv and friends).
    js: `#!/usr/bin/env node\n// atelier-mcp-version: ${version}\nimport { createRequire as __atelierCreateRequire } from 'node:module';\nconst require = __atelierCreateRequire(import.meta.url);`,
  },
  legalComments: 'none',
  logLevel: 'warning',
  minify: false,
});
chmodSync(`${root}mcp/dist/atelier-mcp.mjs`, 0o755);
const kb = Math.round(statSync(`${root}mcp/dist/atelier-mcp.mjs`).size / 1024);
console.log(`build-mcp: mcp/dist/atelier-mcp.mjs (${kb} KB, v${version})`);
