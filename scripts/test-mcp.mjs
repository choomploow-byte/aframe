// The MCP server's own tests: builds the bundle, then runs the integration suites in tests/mcp
// (the SDK client against the built file, the installers, the real claude CLI when present).
// Part of `npm test` already (vitest picks tests/mcp up); this is the shortcut for working on the server.
import { spawnSync } from 'node:child_process';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const run = spawnSync(
  process.execPath,
  [`${root}node_modules/vitest/vitest.mjs`, 'run', 'tests/mcp'],
  {
    cwd: root,
    stdio: 'inherit',
  },
);
process.exit(run.status ?? 1);
