// Renames the product everywhere, so choosing the final name is a one-minute change (Phase 11).
//
//   node scripts/rename.mjs --name "Foo Studio" --slug foostudio [--bundle-id com.foo.studio] [--apply]
//
// Without --apply it only reports what it would change. Run it on a clean git checkout and review the
// diff. It replaces, in every tracked text file (except CHANGELOG.md, which is history):
//   Atelier -> the display name     atelier -> the slug      ATELIER -> the slug in capitals
// and renames tracked files whose names contain "atelier". Links to this repository and its site are
// left alone unless you pass --rename-repo-urls (the repository may keep its old name).
// What it cannot do: the logo and app icons (images), the GitHub repository itself, a free npm name.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

const SKIP_FILES = new Set(['CHANGELOG.md']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|pdf|zip|gz|mp4|webm)$/i;
const REPO_URLS = [
  /github\.com\/choomploow-byte\/atelier/g,
  /choomploow-byte\.github\.io\/atelier/g,
];

export function validateNames({ name, slug, bundleId }) {
  const problems = [];
  if (!name || name.length > 40 || /[\r\n<>&"\\]/.test(name)) {
    problems.push('--name must be 1-40 characters without quotes, angle brackets or backslashes');
  }
  // No dashes: the slug also goes into identifiers (useFoo, __foo) and crate names.
  if (!/^[a-z][a-z0-9]{1,30}$/.test(slug ?? ''))
    problems.push(
      '--slug must be lowercase letters and digits only, starting with a letter (2-31 characters)',
    );
  if (bundleId !== undefined && !/^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*){1,4}$/.test(bundleId))
    problems.push('--bundle-id must look like com.example.app');
  return problems;
}

const IDENT = '[A-Za-z0-9_$]';

/** The text with the old name replaced by the new one. Pure, so it can be tested. */
export function renameText(text, { name, slug, bundleId }, options = {}) {
  const upper = slug.toUpperCase();
  // A name with spaces cannot sit inside an identifier (useAtelier, AtelierState): there it is joined up.
  const pascal = name
    .replace(/[^A-Za-z0-9]+(.)?/g, (_m, c) => (c ? c.toUpperCase() : ''))
    .replace(/^./, (c) => c.toUpperCase());
  let out = text;
  const protectedUrls = [];
  if (!options.renameRepoUrls) {
    for (const re of REPO_URLS) {
      out = out.replace(re, (m) => {
        protectedUrls.push(m);
        return `\u0000URL${protectedUrls.length - 1}\u0000`;
      });
    }
  }
  if (bundleId) out = out.replaceAll('dev.atelier.app', bundleId);
  out = out
    .replaceAll('ATELIER', upper)
    .replace(new RegExp(`(?<!${IDENT})Atelier(?!${IDENT})`, 'g'), () => name)
    .replaceAll('Atelier', pascal)
    .replaceAll('atelier', slug);
  // eslint-disable-next-line no-control-regex
  out = out.replace(/\u0000URL(\d+)\u0000/g, (_m, i) => protectedUrls[Number(i)]);
  return out;
}

export function renamePath(path, { slug }) {
  const dir = dirname(path);
  const base = basename(path).replaceAll('atelier', slug).replaceAll('Atelier', slug);
  return dir === '.' ? base : join(dir, base).replaceAll('\\', '/');
}

function parseArgs(argv) {
  const get = (flag) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  return {
    name: get('--name'),
    slug: get('--slug'),
    bundleId: get('--bundle-id'),
    apply: argv.includes('--apply'),
    renameRepoUrls: argv.includes('--rename-repo-urls'),
  };
}

const isMain =
  process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const args = parseArgs(process.argv.slice(2));
  const problems = validateNames(args);
  if (problems.length > 0) {
    console.error(
      `${problems.join('\n')}\n\nUsage: node scripts/rename.mjs --name "Foo Studio" --slug foostudio [--bundle-id com.foo.studio] [--apply]`,
    );
    process.exit(2);
  }
  const status = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim();
  if (args.apply && status !== '') {
    console.error(
      'The working tree has uncommitted changes. Commit or stash them first, so the rename is one reviewable diff.',
    );
    process.exit(2);
  }
  const files = execFileSync('git', ['ls-files', '-z'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  let changedFiles = 0;
  let renamedFiles = 0;
  let replacements = 0;
  for (const file of files) {
    if (SKIP_FILES.has(file) || BINARY.test(file)) continue;
    let text;
    try {
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue;
    const next = renameText(text, args, args);
    if (next !== text) {
      changedFiles += 1;
      replacements += (text.match(/ATELIER|Atelier|atelier/g) ?? []).length;
      if (args.apply) writeFileSync(file, next);
    }
  }
  const moves = files
    .filter((f) => !BINARY.test(f) || /atelier/i.test(basename(f)))
    .filter((f) => /atelier/i.test(basename(f)));
  for (const f of moves) {
    const to = renamePath(f, args);
    if (to !== f) {
      renamedFiles += 1;
      if (args.apply) {
        execFileSync('git', ['mv', f, to]);
      }
    }
  }
  console.log(
    `${args.apply ? 'Changed' : 'Would change'} ${changedFiles} files (${replacements} occurrences) and ${args.apply ? 'renamed' : 'rename'} ${renamedFiles} files.`,
  );
  console.log(
    `\nDone by hand: the logo and app icons (brand/, site/img, src-tauri/icons: they contain the old name or mark), the GitHub repository name${args.renameRepoUrls ? '' : ' and the links to it'}, a free npm package name for "${args.slug}-mcp", and signing identities.\nThen: npm run build:mcp && npm test.`,
  );
  if (!args.apply) console.log('\nThis was a dry run. Add --apply to write the changes.');
}
