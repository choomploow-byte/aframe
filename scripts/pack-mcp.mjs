// Builds the npm package for the standalone MCP server (docs/09, Route 3): `npx -y aframe-mcp install`.
// The package is the same single bundle the app carries, with a bin entry, a README and the licence.
//   node scripts/pack-mcp.mjs [outDir]      (default: mcp-package)
// Run `npm run build:mcp` first. Publishing is a separate, deliberate step (release workflow).
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const out = resolve(process.argv[2] ?? join(root, 'mcp-package'));
const bundle = join(root, 'mcp', 'dist', 'aframe-mcp.mjs');
if (!existsSync(bundle)) {
  console.error('mcp/dist/aframe-mcp.mjs is missing: run `npm run build:mcp` first.');
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The bin file needs a shebang to run directly on macOS and Linux.
let code = readFileSync(bundle, 'utf8');
if (!code.startsWith('#!')) code = `#!/usr/bin/env node\n${code}`;
writeFileSync(join(out, 'aframe-mcp.mjs'), code);
chmodSync(join(out, 'aframe-mcp.mjs'), 0o755);
copyFileSync(join(root, 'LICENSE'), join(out, 'LICENSE'));
copyFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), join(out, 'THIRD-PARTY-NOTICES.md'));

writeFileSync(
  join(out, 'package.json'),
  `${JSON.stringify(
    {
      name: 'aframe-mcp',
      version: pkg.version,
      description:
        'The AFrame design canvas as an MCP server: let Claude Code, Codex or Cursor design, screenshot, lint and export UI.',
      license: 'MIT',
      type: 'module',
      bin: { 'aframe-mcp': 'aframe-mcp.mjs' },
      files: ['aframe-mcp.mjs', 'README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md'],
      engines: { node: '>=20' },
      keywords: ['mcp', 'model-context-protocol', 'design', 'claude-code', 'codex', 'ui'],
      repository: { type: 'git', url: 'git+https://github.com/choomploow-byte/atelier.git' },
      homepage: 'https://choomploow-byte.github.io/atelier/',
      bugs: { url: 'https://github.com/choomploow-byte/atelier/issues' },
    },
    null,
    2,
  )}\n`,
);

writeFileSync(
  join(out, 'README.md'),
  `# aframe-mcp

The MCP server for [AFrame](https://choomploow-byte.github.io/atelier/), an open-source design canvas that an AI
agent can drive. This package is the same single file the AFrame desktop app carries.

\`\`\`bash
npx -y aframe-mcp install     # registers it with Claude Code, Codex and Cursor, whichever you have
npx -y aframe-mcp doctor      # checks Node, the app and each registration
npx -y aframe-mcp print-config   # the JSON for any other MCP host
\`\`\`

Needs Node 20 or newer. Most tools work without the app open; screenshots and image export need the
AFrame app running. Nothing is sent anywhere: the server reads and writes files under \`~/.aframe\` and
only the folders you tell an agent to export into.

Then ask your agent: *"in aframe, improve my design"*.

MIT licensed. Source and the desktop app: https://github.com/choomploow-byte/atelier
`,
);
console.log(`Wrote ${out} (aframe-mcp ${pkg.version})`);
