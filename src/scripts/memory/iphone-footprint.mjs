#!/usr/bin/env node
// iphone-footprint.mjs, the real-device readers (ENGINE-MEMORY EM10; meta docs/plans/ENGINE-MEMORY-PLAN.md). Over
// pymobiledevice3 (run through uvx, no root, USB or Wi-Fi), while Jake drives the phone:
//   (a) physFootprint of com.apple.WebKit.WebContent and com.apple.WebKit.GPU every 500 ms [K] (dvt sysmon),
//   (b) the syslog lines that say where the limit is and when it was crossed ("Memory Limits: active N inactive N",
//       "exceeded mem limit"),
//   (c) after the run, the newest JetsamEvent-*.ips pulled and printed as a table (process, pages x page size, reason,
//       largest process).
//
//   src/scripts/memory/iphone-footprint.sh [--seconds=300] [--udid=<udid>] [--out=tmp/iphone-footprint] [--dry-run]
//
// --dry-run prints the commands and exits 0. With no device attached it exits 1 and says so. Untested on a phone (none
// was attached when it was written); the parsers are tested on committed samples (test/fixtures/iphone-memory/).
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve as resolvePath } from 'node:path';

const PMD = ['uvx', '--python', process.env.WS_IPHONE_PYTHON ?? '>=3.11', '--from', 'pymobiledevice3', 'pymobiledevice3'];
export const PROCESSES = Object.freeze(['com.apple.WebKit.WebContent', 'com.apple.WebKit.GPU']);
const MB = 1e6;

/** The pymobiledevice3 commands for one run. @param {{udid?:string, seconds:number, out:string}} o */
export function commands(o) {
  const device = o.udid ? ['--udid', o.udid] : [];
  return {
    list: [...PMD, 'usbmux', 'list'],
    sysmon: PROCESSES.map((name) => [...PMD, 'developer', 'dvt', 'sysmon', 'process', 'monitor', 'process', '--filter', `name=${name}`,
      '--key', 'name', '--key', 'pid', '--key', 'physFootprint', '--choose', 'last', '--keep-monitoring', '--interval', '500',
      '--duration', String(o.seconds * 1000), '--output', join(o.out, `sysmon-${name.split('.').at(-1)}.jsonl`), ...device]),
    syslog: [...PMD, 'syslog', 'live', ...device],
    crash: [...PMD, 'crash', 'pull', join(o.out, 'crash'), '--match', '^JetsamEvent', ...device],
  };
}

/** One sysmon JSON line. @param {string} line */
export function parseSysmon(line) {
  try {
    const o = JSON.parse(line), bytes = Number(o.physFootprint), pid = Number(o.pid);
    return typeof o.name === 'string' && o.physFootprint !== null && Number.isSafeInteger(bytes) && bytes >= 0 &&
      Number.isSafeInteger(pid) && pid > 0 ? { name: o.name, pid, physFootprint: bytes } : null;
  } catch { return null; }
}

/** A syslog line that names the limit or its crossing, else null. @param {string} line */
export function parseSyslog(line) {
  const limits = /Memory Limits: active (\d+) inactive (\d+)/u.exec(line);
  if (limits) return { kind: 'limits', activeMB: Number(limits[1]), inactiveMB: Number(limits[2]), line: line.trim() };
  const over = /([\w.]+)\[(\d+)\] exceeded mem limit: (\w+) (\d+) MB(?: \((fatal|non-fatal)\))?/u.exec(line);
  if (over) return { kind: 'exceeded', process: over[1], pid: Number(over[2]), limit: over[3], limitMB: Number(over[4]), fatal: over[5] !== 'non-fatal', line: line.trim() };
  return null;
}

/** A JetsamEvent .ips: a JSON header line, then the report. Rows by footprint, largest first.
 * @param {string} text */
export function parseJetsam(text) {
  const start = text.indexOf('\n{');
  const body = JSON.parse(start === -1 ? text : text.slice(start + 1));
  const pageSize = Number(body.memoryStatus?.pageSize ?? 16384);
  const rows = (body.processes ?? []).map((/** @type {any} */ p) => ({ name: String(p.name ?? '?'), pid: Number(p.pid), pages: Number(p.rpages ?? 0),
    bytes: Number(p.rpages ?? 0) * pageSize, lifetimeMaxBytes: p.lifetimeMax === undefined ? null : Number(p.lifetimeMax) * pageSize, reason: p.reason ?? null }))
    .sort((/** @type {{bytes:number}} */ a, /** @type {{bytes:number}} */ b) => b.bytes - a.bytes);
  return { date: body.date ?? null, largestProcess: body.largestProcess ?? null, pageSize, killed: rows.filter((/** @type {{reason:string|null}} */ r) => r.reason !== null), rows };
}

/** @param {ReturnType<typeof parseJetsam>} j */
export function jetsamLines(j) {
  const lines = [`JetsamEvent ${j.date ?? ''}: largest process ${j.largestProcess ?? '?'}, page size ${j.pageSize} B [K]`];
  for (const r of [...j.killed, ...j.rows.filter((row) => row.reason === null).slice(0, 8)])
    lines.push(`  ${r.name.slice(0, 40).padEnd(40)} ${(r.bytes / MB).toFixed(0).padStart(6)} MB  ${r.pages} pages${r.reason ? `  killed: ${r.reason}` : ''}`);
  return lines;
}

/** @param {string[]} argv */
export function options(argv) {
  const flag = (/** @type {string} */ name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
  return { seconds: Number(flag('seconds') ?? 300), udid: flag('udid'), out: resolvePath(flag('out') ?? 'tmp/iphone-footprint'), dryRun: argv.includes('--dry-run') };
}

/** @param {string[]} argv @param {{devices?:() => unknown[], log?:(line:string) => void}} [io] */
export async function main(argv, io = {}) {
  const o = options(argv), log = io.log ?? console.log, c = commands(o);
  if (o.dryRun) { for (const cmd of [c.list, ...c.sysmon, c.syslog, c.crash]) log(cmd.join(' ')); return 0; }
  const devices = io.devices ?? (() => { try { return JSON.parse(execFileSync(c.list[0], c.list.slice(1), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch { return []; } });
  if (devices().length === 0) { log('iphone-footprint: no iPhone attached (pymobiledevice3 usbmux list is empty): plug it in, unlock it and trust this Mac'); return 1; }
  mkdirSync(join(o.out, 'crash'), { recursive: true });
  const syslogOut = createWriteStream(join(o.out, 'syslog-memory.log'));
  const children = c.sysmon.map((cmd) => spawn(cmd[0], cmd.slice(1), { stdio: ['ignore', 'ignore', 'inherit'] }));
  const syslog = spawn(c.syslog[0], c.syslog.slice(1), { stdio: ['ignore', 'pipe', 'inherit'] });
  let rest = '';
  syslog.stdout.on('data', (/** @type {Buffer} */ chunk) => {
    const lines = (rest + chunk.toString()).split('\n'); rest = lines.pop() ?? '';
    for (const line of lines) { const hit = parseSyslog(line); if (hit) { syslogOut.write(`${JSON.stringify(hit)}\n`); log(`syslog ${hit.kind}: ${hit.line.slice(0, 200)}`); } }
  });
  log(`iphone-footprint: reading for ${o.seconds} s into ${o.out}`);
  await Promise.all(children.map((child) => new Promise((resolve) => { child.on('exit', resolve); })));
  syslog.kill('SIGINT'); syslogOut.end();
  for (const name of PROCESSES) {
    const file = join(o.out, `sysmon-${name.split('.').at(-1)}.jsonl`);
    let peak = 0, n = 0;
    try { for (const line of readFileSync(file, 'utf8').split('\n')) { const s = parseSysmon(line); if (s) { n++; peak = Math.max(peak, s.physFootprint); } } } catch { /* no samples */ }
    log(`${name}: ${n} samples, peak physFootprint ${(peak / MB).toFixed(0)} MB [K]`);
  }
  try { execFileSync(c.crash[0], c.crash.slice(1), { stdio: 'inherit' }); } catch { log('iphone-footprint: crash pull failed'); }
  const dir = join(o.out, 'crash');
  const newest = readdirSync(dir, { recursive: true }).map(String).filter((f) => /JetsamEvent.*\.ips$/u.test(f)).map((f) => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  if (newest) for (const line of jetsamLines(parseJetsam(readFileSync(newest, 'utf8')))) log(line); else log('no JetsamEvent report on the device');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) process.exitCode = await main(process.argv.slice(2));
