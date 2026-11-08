// Builds the npm package for the standalone MCP server (docs/09, Route 3): `npx -y atelier-mcp install`.
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
const bundle = join(root, 'mcp', 'dist', 'atelier-mcp.mjs');
if (!existsSync(bundle)) {
  console.error('mcp/dist/atelier-mcp.mjs is missing: run `npm run build:mcp` first.');
  process.exit(1);
}
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// The bin file needs a shebang to run directly on macOS and Linux.
let code = readFileSync(bundle, 'utf8');
if (!code.startsWith('#!')) code = `#!/usr/bin/env node\n${code}`;
writeFileSync(join(out, 'atelier-mcp.mjs'), code);
chmodSync(join(out, 'atelier-mcp.mjs'), 0o755);
copyFileSync(join(root, 'LICENSE'), join(out, 'LICENSE'));
copyFileSync(join(root, 'THIRD-PARTY-NOTICES.md'), join(out, 'THIRD-PARTY-NOTICES.md'));

writeFileSync(
  join(out, 'package.json'),
  `${JSON.stringify(
    {
      name: 'atelier-mcp',
      version: pkg.version,
      description:
        'The Atelier design canvas as an MCP server: let Claude Code, Codex or Cursor design, screenshot, lint and export UI.',
      license: 'MIT',
      type: 'module',
      bin: { 'atelier-mcp': 'atelier-mcp.mjs' },
      files: ['atelier-mcp.mjs', 'README.md', 'LICENSE', 'THIRD-PARTY-NOTICES.md'],
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
  `# atelier-mcp

The MCP server for [Atelier](https://choomploow-byte.github.io/atelier/), an open-source design canvas that an AI
agent can drive. This package is the same single file the Atelier desktop app carries.

\`\`\`bash
npx -y atelier-mcp install     # registers it with Claude Code, Codex and Cursor, whichever you have
npx -y atelier-mcp doctor      # checks Node, the app and each registration
npx -y atelier-mcp print-config   # the JSON for any other MCP host
\`\`\`

Needs Node 20 or newer. Most tools work without the app open; screenshots and image export need the
Atelier app running. Nothing is sent anywhere: the server reads and writes files under \`~/.atelier\` and
only the folders you tell an agent to export into.

Then ask your agent: *"in atelier, improve my design"*.

MIT licensed. Source and the desktop app: https://github.com/choomploow-byte/atelier
`,
);
console.log(`Wrote ${out} (atelier-mcp ${pkg.version})`);
