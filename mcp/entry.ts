// The bundle's entry point: `node atelier-mcp.mjs [command]`. Kept separate from cli.ts so tests can
// import the CLI without starting a server.
import { fileURLToPath } from 'node:url';
import { main } from './cli';

main(process.argv.slice(2), fileURLToPath(import.meta.url)).then(
  (code) => {
    if (code !== 0) process.exitCode = code;
  },
  (err: unknown) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exitCode = 1;
  },
);
