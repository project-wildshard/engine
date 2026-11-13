#!/usr/bin/env node
// DEVICE-TELEMETRY DT5 (meta docs/plans/DEVICE-TELEMETRY-PLAN.md): the last N connects' devices from a door's journal, as a table.
// The door writes one `client.device` JSON line per connect (src/server/host/dedicated/world.ts, src/shared/engine/net/deviceWord.ts).
//   ssh wildshard-agent journalctl -u wildshard-server@staging --since today -o cat | node scripts/devices.mjs --last 20
//   node scripts/devices.mjs --last 20 journal.txt        (a saved journal)
//   node scripts/devices.mjs --json < journal.txt         (the lines themselves)
// Read-only: it reads text and prints. Lines carry device characteristics and the player id only, never an address.
import { readFileSync } from 'node:fs';

const COLUMNS = [['player', 18], ['model', 16], ['platform', 10], ['platformVersion', 8], ['browser', 24], ['gpu', 36], ['screen', 10], ['dpr', 5], ['memory', 4], ['cores', 4], ['build', 12]];

/** The `client.device` lines in a journal's text, oldest first; anything else on a line (a journal prefix) is skipped. */
export function deviceLines(text) {
  const out = [];
  for (const raw of text.split('\n')) {
    const at = raw.indexOf('{"at":"client.device"');
    if (at === -1) continue;
    try { out.push(JSON.parse(raw.slice(at))); } catch { /* a cut line */ }
  }
  return out;
}

/** The lines as a fixed-width table. */
export function deviceTable(lines) {
  const cell = (value, width) => { const said = value === undefined ? '-' : String(value); return (said.length > width ? `${said.slice(0, width - 1)}~` : said).padEnd(width); };
  const head = COLUMNS.map(([name, width]) => cell(name, width)).join(' ');
  return [head, ...lines.map(line => COLUMNS.map(([name, width]) => cell(line[name], width)).join(' '))].join('\n');
}

function main(argv) {
  const lastAt = argv.indexOf('--last'), last = lastAt === -1 ? 20 : Number(argv[lastAt + 1] ?? 20);
  const files = argv.filter((arg, index) => !arg.startsWith('--') && index !== lastAt + 1);
  const text = files.length === 0 ? readFileSync(0, 'utf8') : files.map(file => readFileSync(file, 'utf8')).join('\n');
  const lines = deviceLines(text).slice(-Math.max(1, last));
  if (argv.includes('--json')) { for (const line of lines) console.log(JSON.stringify(line)); return; }
  console.log(lines.length === 0 ? 'no client.device lines (a door from before DEVICE-TELEMETRY writes none)' : deviceTable(lines));
}

if (import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
