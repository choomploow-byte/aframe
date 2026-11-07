// Child process for tests/node/home-fs.test.ts. Argv: <home> <path> <mode> [count]
//   mode "count": do <count> successful read-modify-write increments, then exit 0.
//   mode "forever": increment until killed (the parent hard-kills it mid-write).
import { HomeFs, parseRev } from '../../../mcp/home-fs';

const [home, rel, mode, countArg] = process.argv.slice(2);
if (!home || !rel || !mode) throw new Error('usage: writer <home> <path> <mode> [count]');
const fsx = new HomeFs(home, { lockStaleMs: 600, lockWaitMs: 8000 });
const target = mode === 'count' ? Number(countArg) : Infinity;
const body = 'x'.repeat(200_000); // big enough that a kill lands inside a write often

let done = 0;
while (done < target) {
  const text = await fsx.read(rel);
  const rev = text === null ? 0 : (parseRev(text) ?? 0);
  const doc = JSON.stringify({
    schema: 1,
    rev: rev + 1,
    id: 'p_kill1',
    by: process.pid,
    pad: body,
  });
  const r = await fsx.writeDoc(rel, doc, text === null ? null : rev);
  if (r.ok) done += 1;
}
process.exit(0);
