import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { ATTRIBUTION } from '../../scripts/attribution.mjs';

/**
 * CC BY 4.0 (the Font Awesome icons) asks for attribution. Bundlers drop comments, so the build adds
 * the notice on purpose; this proves the shipped JavaScript really carries it, and that the notice
 * file and the generated data agree with it.
 */
describe('icon attribution', () => {
  const needle = 'Font Awesome Free 7.3.1';

  it('is in the MCP server bundle', () => {
    const bundle = readFileSync('mcp/dist/atelier-mcp.mjs', 'utf8');
    expect(bundle).toContain(ATTRIBUTION);
    // after the code, so the version header on the first lines is where the app looks for it
    expect(bundle.indexOf(ATTRIBUTION)).toBeGreaterThan(bundle.length - ATTRIBUTION.length - 5);
  });

  it('is in the app bundle', async () => {
    const out = mkdtempSync(join(tmpdir(), 'atelier-attr-'));
    try {
      await build({
        logLevel: 'silent',
        build: { outDir: out, emptyOutDir: true, sourcemap: false },
      });
      const assets = join(out, 'assets');
      const js = readdirSync(assets).filter((f) => f.endsWith('.js'));
      const carrying = js.filter((f) =>
        readFileSync(join(assets, f), 'utf8').includes(ATTRIBUTION),
      );
      expect(carrying.length).toBeGreaterThanOrEqual(1);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);

  it('matches the data file, the notices and the installed package version', () => {
    const data = readFileSync('src/core/icon-data.ts', 'utf8');
    expect(data).toContain(needle);
    expect(ATTRIBUTION).toContain(needle);
    expect(readFileSync('THIRD-PARTY-NOTICES.md', 'utf8')).toContain(needle);
    const pkg = JSON.parse(
      readFileSync('node_modules/@fortawesome/free-solid-svg-icons/package.json', 'utf8'),
    ) as { version: string };
    expect(pkg.version).toBe('7.3.1');
  });

  it('keeps the Luckiest Guy licence text, because it is Apache 2.0 and not OFL', () => {
    expect(readFileSync('licenses/LuckiestGuy-Apache-2.0.txt', 'utf8')).toContain('Apache License');
  });
});
