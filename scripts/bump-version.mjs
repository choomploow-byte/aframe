// Sets the app version everywhere the release check wants it to agree:
// package.json, package-lock.json, src-tauri/Cargo.toml, src-tauri/Cargo.lock, src-tauri/tauri.conf.json.
// (mcp/generated.ts follows on the next `npm run build:mcp`.) Usage: node scripts/bump-version.mjs 0.4.0
import { readFileSync, writeFileSync } from 'node:fs';

const next = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(next ?? '')) {
  console.error('Usage: node scripts/bump-version.mjs <major.minor.patch>');
  process.exit(2);
}
const read = (p) => readFileSync(p, 'utf8');
const pkg = JSON.parse(read('package.json'));
const old = pkg.version;

const jsonVersion = (path, update) => {
  const text = read(path);
  const out = update(text);
  if (out === text && old !== next) throw new Error(`${path}: nothing changed`);
  writeFileSync(path, out);
};

// The first "version" key is the package's own in each of these JSON files.
const firstVersion = (text) => text.replace(/"version": "[^"]+"/, `"version": "${next}"`);
jsonVersion('package.json', firstVersion);
jsonVersion('src-tauri/tauri.conf.json', firstVersion);
// package-lock.json: the root and packages[""] both carry the version.
jsonVersion('package-lock.json', (t) => {
  const lock = JSON.parse(t);
  lock.version = next;
  if (lock.packages?.['']) lock.packages[''].version = next;
  return `${JSON.stringify(lock, null, 2)}\n`;
});
jsonVersion('src-tauri/Cargo.toml', (t) => t.replace(/^version = "[^"]+"/m, `version = "${next}"`));
// Cargo.lock: the entry for this crate (named in Cargo.toml).
const crate = /^name = "([^"]+)"/m.exec(read('src-tauri/Cargo.toml'))?.[1];
jsonVersion('src-tauri/Cargo.lock', (t) =>
  t.replace(new RegExp(`(name = "${crate}"\\nversion = )"[^"]+"`), `$1"${next}"`),
);
console.log(`${old} -> ${next}`);
