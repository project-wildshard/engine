#!/usr/bin/env node
// SHARD-SIZE row 8 (docs/plans/multi-repo/SHARD-SIZE-PLAN.md in project-wildshard-meta): what the build's gate can't see. The gate
// reads the packs book, so it is blind to the title stage, the desktop and the grid flow, and to a book that stopped
// telling the truth. This runs scripts/shard-wire-meter.mjs against a served build and reports any title over 3 MB or
// any flow over its book by 10 %. It only reports: it holds no deploy step and refuses nothing.
// .github/workflows/size-watch.yml runs it nightly against production and files what it finds.
//
//   node scripts/shard-size-watch.mjs --upstream <url> --out <dir> [--only pine-hollow:phone,grid:phone]
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';

export const TITLE_LIMIT_BYTES = 3_000_000;
export const BOOK_SLACK = 0.1;
/** The flows the gate can't see. A desktop grid has its own home's book, and phones are what ship. */
export const WATCHED = ['pine-hollow:phone', 'driftwood-isle:phone', 'far-reach:phone', 'sunscar-dunes:phone', 'nalati-grasslands:phone',
  'nine-dragon-stack:phone', 'pine-hollow:desktop', 'grid:phone'];
const MB = bytes => `${(bytes / 1e6).toFixed(1)} MB`;

/** The packs book's row for one watched flow. The meter's profile has Developer on, so a grid entry reads mode 100.
 * @param {{ client: Record<string, Record<string, { wireBytes?: number }>>, grid: Record<string, Record<string, Record<string, { wireBytes?: number }>>> }} book
 * @param {string} shard @param {string} tier @param {string} home the grid's home shard */
export function bookBytes(book, shard, tier, home = 'driftwood-isle') {
  const row = shard === 'grid' ? (book.grid['100'] ?? book.grid['000'])?.[home]?.[tier] : book.client[shard]?.[tier];
  return row?.wireBytes;
}

/** What one night's readings say. Pure: readings in, findings out. A run that never settled is a finding, not a pass.
 * The entry is held against the book: the title's own art isn't in it, and on Signal Dunes that alone is 25 % of the book.
 * @param {readonly { flow: string, title: number, entry: number, book: number | undefined, stoppedOn: string | null }[]} readings
 * @returns {string[]} */
export function sizeFindings(readings) {
  return readings.flatMap(row => {
    const lines = [];
    if (row.stoppedOn !== 'network idle') lines.push(`${row.flow}: the meter stopped on ${String(row.stoppedOn)}, so this night has no reading`);
    if (row.title > TITLE_LIMIT_BYTES) lines.push(`${row.flow}: title ${MB(row.title)}, past ${MB(TITLE_LIMIT_BYTES)}`);
    if (row.book === undefined) lines.push(`${row.flow}: the packs book has no row`);
    else if (row.entry > row.book * (1 + BOOK_SLACK)) lines.push(`${row.flow}: entry ${MB(row.entry)} on the wire against a book of ${MB(row.book)}`);
    return lines;
  });
}

if (process.argv[1] === import.meta.filename) {
  const { values: o } = parseArgs({ options: { upstream: { type: 'string' }, out: { type: 'string' }, only: { type: 'string' } } });
  if (o.upstream === undefined || o.out === undefined) throw new Error('usage: --upstream <url> --out <dir> [--only shard:tier,...]');
  const root = resolve(import.meta.dirname, '..'), out = resolve(o.out), readings = [];
  mkdirSync(out, { recursive: true });
  let build = null, book = null;
  for (const flow of o.only?.split(',') ?? WATCHED) {
    const [shard = '', tier = 'phone'] = flow.split(':'), file = join(out, `${flow.replace(':', '-')}.json`), grid = shard === 'grid';
    const meter = spawnSync(process.execPath, [join(root, 'scripts/shard-wire-meter.mjs'), '--root', root, '--upstream', o.upstream, '--shard', grid ? 'driftwood-isle' : shard,
      '--tier', tier, '--flow', grid ? 'grid' : 'select', '--settle', '12000', '--out', file], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 26 });
    const row = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
    if (row !== null && row.build !== build) {
      build = row.build;
      const answer = await fetch(new URL(`assets/spawn/packs-${String(build)}.json`, o.upstream));
      book = answer.ok ? await answer.json() : null;
    }
    readings.push({ flow, title: row?.byStage?.title ?? 0, entry: row?.byStage?.entry ?? 0, book: book === null ? undefined : bookBytes(book, shard, tier),
      stoppedOn: row?.stoppedOn ?? `meter exit ${String(meter.status)}` });
  }
  const findings = sizeFindings(readings);
  const lines = [`Build \`${String(build)}\`.`, '', '| Flow | Title | Entry | Book |', '|---|---|---|---|',
    ...readings.map(row => `| ${row.flow} | ${MB(row.title)} | ${MB(row.entry)} | ${row.book === undefined ? 'none' : MB(row.book)} |`),
    '', ...findings.length === 0 ? ['Nothing over its line.'] : findings.map(line => `- ${line}`)];
  writeFileSync(join(out, 'report.md'), `${lines.join('\n')}\n`);
  console.info(lines.join('\n'));
  process.exitCode = findings.length === 0 ? 0 : 1;
}
