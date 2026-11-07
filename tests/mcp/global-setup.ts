// Builds the MCP bundle once before any integration test runs, so the tests exercise the file that
// ships, not the TypeScript sources.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export default function setup(): void {
  const script = fileURLToPath(new URL('../../scripts/build-mcp.mjs', import.meta.url));
  execFileSync(process.execPath, [script], { stdio: 'inherit' });
}
