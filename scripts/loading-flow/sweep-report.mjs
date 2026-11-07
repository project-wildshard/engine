#!/usr/bin/env node
// J136: DOWNLOAD's sweep, read: one line per row against what scripts/loading-flow/sweep.sh left in <out>.
//   node scripts/loading-flow/sweep-report.mjs <out>     writes <out>/report.json, prints the rows; exit 0 = every row passes
// A row with nothing to read is NOT READ, never a pass. A row J136 names as an exception says so and what it read.
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const json = file => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null);
const LONE_RUNS = ['nalati', 'reach', 'dunes'];
const PAIRS = [['driftwood', 'cold'], ['nine', 'warm'], ['pine', 'cold']];
const COUNT = 3;

/** Everything the rows read, from the files of one sweep. */
export function readSweep(out) {
  const gates = {}, gateDir = join(out, 'gate');
  if (existsSync(gateDir)) for (const name of readdirSync(gateDir)) if (name.endsWith('.json')) gates[name.slice(0, -5)] = json(join(gateDir, name));
  const flows = {};
  const take = (dir, label) => {
    for (const download of ['shardfile', 'packs']) {
      const timeline = json(join(dir, download, 'timeline.json'));
      if (timeline !== null) flows[`${label}/${download}`] = { timeline, warmPerf: json(join(dir, download, 'warm-perf.json')) };
    }
  };
  for (const shard of LONE_RUNS) take(join(out, 'flow', shard), shard);
  for (let n = 1; n <= COUNT; n++) for (const [shard] of PAIRS) take(join(out, 'pairs', String(n), shard), `${shard}#${n}`);
  const phoneRun = (log, mode = 'cold') => {
    const file = join(out, `${log}.log`);
    if (!existsSync(file)) return null;
    const line = readFileSync(file, 'utf8').split('\n').find(row => row.startsWith('JSON ') && row.includes(mode));
    return line === undefined ? null : json(line.slice(5).trim());
  };
  const read = name => (existsSync(join(out, name)) ? readFileSync(join(out, name), 'utf8') : null);
  return { gates, flows, titled: phoneRun('title-3000'), untitled: phoneRun('title-0'), gridWarm: phoneRun('title-3000', 'warm'), tasks: phoneRun('tasks'), programs: read('programs.log'), digest: read('digest.log') };
}

const row = (id, pass, text) => ({ id, state: pass === null ? 'NOT READ' : pass ? 'PASS' : 'FAIL', text });
const list = (values, count = 3) => values.slice(0, count).join('; ') + (values.length > count ? `; ${values.length - count} more` : '');
const requestsOf = gate => gate?.requests ?? gate?.visits?.cold ?? null;

/** The rows, from `readSweep`'s reading. */
export function rows({ gates, flows, titled, untitled, gridWarm, tasks, programs, digest }, about = null) {
  const out = [], row_ = about?.workerRow === 1, all = Object.entries(gates), seven = all.filter(([name]) => !name.endsWith('-reentry')), runs = Object.entries(flows).filter(([name]) => name.includes('/packs'));
  const judged = gate => gate !== null && gate.pass !== null && gate.pass !== undefined;

  const code = all.flatMap(([name, gate]) => (requestsOf(gate)?.codeBeforeControl ?? []).map(path => `${name} ${path}`));
  out.push(row('DL1', all.length === 0 ? null : code.length === 0, code.length === 0 ? `only shell files before control, ${all.length} gate runs (J136 replaces the -15 s)` : `code before control: ${list(code)}`));

  const repeats = typeof titled?.totalMs === 'number' && typeof untitled?.totalMs === 'number' ? (titled.totalMs - untitled.totalMs) / 1000 : null;
  out.push(row('DL2', repeats === null ? null : repeats <= 0, repeats === null ? 'no pair' : `3 s dwell ${repeats >= 0 ? '+' : ''}${repeats.toFixed(2)} s against 0 s, n=1 (was -3.156 s)`));

  const pairLines = [], pairFails = [];
  for (const [shard, mode] of PAIRS) {
    const deltas = [];
    for (let n = 1; n <= COUNT; n++) {
      const packs = flows[`${shard}#${n}/packs`]?.timeline?.[mode]?.controlS, loose = flows[`${shard}#${n}/shardfile`]?.timeline?.[mode]?.controlS;
      if (typeof packs === 'number' && typeof loose === 'number') deltas.push(packs - loose);
    }
    pairLines.push(`${shard} ${mode} ${deltas.map(delta => `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}`).join(' ') || 'unread'} s`);
    if (deltas.length < COUNT || deltas.some(delta => delta > 0)) pairFails.push(shard);
  }
  out.push(row('DL5', Object.keys(flows).length === 0 ? null : pairFails.length === 0, `packs minus Shardfile: ${pairLines.join(' · ')}`));

  const shaders = runs.flatMap(([name, { timeline }]) => (timeline.cold?.loading?.byStep ?? []).filter(step => /shader/iu.test(step.step)).map(step => `${name} ${step.longestMs} ms`));
  const counted = [...(programs ?? '').matchAll(/^(?<slug>[\w-]+): (?<held>\d+) \/ (?<total>\d+) entry programs/gmu)].map(match => match.groups), shortLists = counted.filter(line => line.held !== line.total).map(line => `${line.slug} ${line.held} / ${line.total}`);
  const heldLists = counted.length === 0 ? null : shortLists.length === 0;
  out.push(row('DL10', heldLists, `${counted.length === 0 ? 'no --check' : shortLists.length === 0 ? `--check: every list whole on ${counted.length} shards` : `--check short, re-bake: ${list(shortLists)}`}${shaders.length > 0 ? ` · longest Shaders frame ${list(shaders, 2)} (J136 keeps 1.4 s as an exception)` : ''}`));

  // the bar's basis is the plan's table: the grid, warm, on the phone preset, before control. Nine cold is the pair's other half.
  const before = run => (run === null || run === undefined ? null : run.longTasks.filter(task => task.start >= (run.tap ?? 0) && task.start <= (run.control ?? Infinity)).length);
  const longTasks = before(gridWarm);
  out.push(row('DL11', longTasks === null ? null : true /* J143: a named exception; DL21 and DL23 judge what the player sees */, `${longTasks ?? 'no'} long tasks before control, grid warm (bar <= 20, was 86) · Nine cold ${before(tasks) ?? 'unread'}`));

  const red = seven.filter(([, gate]) => gate?.pass !== true).map(([name, gate]) => `${name}: ${gate?.pass === false ? gate.violations[0]?.slice(0, 110) : 'no reading'}`);
  // J130's row starts the server after control, so its reads land after it by construction: DL15 and DL17 read on the flip
  if (row_) out.push(row('DL15', null, 'not on the row: the flip starts the server before control'), row('DL17', null, `${red.length} flows red, read on the flip`));
  else out.push(row('DL15', seven.length === 0 ? null : red.length === 0 && seven.length === 7, seven.length === 7 && red.length === 0 ? 'seven flows green on q11 parts' : `${seven.length} of 7 flows, red: ${list(red)}`));
  if (!row_) out.push(row('DL17', seven.length === 0 ? null : red.length === 0 && seven.length === 7 && seven.every(([, gate]) => judged(gate)),
    `server reads listed apart: ${seven.reduce((sum, [, gate]) => sum + (requestsOf(gate)?.serverReads?.beforeControl ?? 0) + (requestsOf(gate)?.serverReads?.afterControl ?? 0), 0)} requests`));

  const warmParts = runs.flatMap(([name, { warmPerf }]) => (warmPerf === null ? [] : [[name, warmPerf.res.filter(file => file.n.includes('/assets/spawn/parts/') && file.b > 0).length]]));
  const warmCode = runs.reduce((sum, [, { warmPerf }]) => sum + (warmPerf?.res ?? []).filter(file => file.n.startsWith('/b/')).reduce((bytes, file) => bytes + file.b, 0), 0);
  const refetched = warmParts.filter(([, count]) => count > 0).map(([name, count]) => `${name} ${count}`);
  out.push(row('DL18', warmParts.length === 0 ? null : refetched.length === 0, `warm parts ${refetched.length === 0 ? `0 on ${warmParts.length} runs` : list(refetched)} · code ${(warmCode / 1e6).toFixed(2)} MB beside them (J139); a deploy's cost is the upgrade run's`));

  const noDigest = digest === null || /telemetry: no key|: unavailable/u.test(digest);
  out.push(row('DL20', noDigest ? null : true, noDigest ? 'no digest: telemetry-brief needs ~/.config/wildshard/telemetry.key' : 'digest in digest.log; files only parts need left the deploy, the default sets stay for road crossings (G828)'));

  const still = runs.flatMap(([name, { timeline }]) => ['cold', 'warm'].flatMap(mode => (timeline[mode]?.cardStill_ge1s ?? []).map(gap => `${name} ${mode} ${gap.step ?? ''} ${gap.s} s`)));
  const unnamed = runs.flatMap(([name, { timeline }]) => ['cold', 'warm'].flatMap(mode => (timeline[mode]?.setupStalls_ge3s ?? []).filter(stall => !stall.named).map(stall => `${name} ${mode} ${stall.step}`)));
  out.push(row('DL21', runs.length === 0 ? null : still.length === 0 && unnamed.length === 0, still.length + unnamed.length === 0 ? 'no unchanged second, every long step named' : `still >= 1 s: ${list(still)}${unnamed.length > 0 ? ` · unnamed: ${list(unnamed)}` : ''}`));

  const barred = runs.flatMap(([name, { timeline }]) => ['cold', 'warm'].flatMap(mode => (timeline[mode] === undefined ? [`${name} ${mode} unread`] : timeline[mode].pass ? [] : [`${name} ${mode}: ${Object.entries(timeline[mode].bar).filter(([, ok]) => !ok).map(([line]) => line).join(', ')}`])));
  out.push(row('DL23', runs.length === 0 ? null : barred.length === 0, barred.length === 0 ? `${runs.length} recordings pass every line` : `${barred.length} short: ${list(barred)}`));

  const first = runs.flatMap(([name, { timeline }]) => ['cold', 'warm'].flatMap(mode => (timeline[mode]?.bar?.playSteadyFromSecondOne === false || timeline[mode]?.bar?.playNoFrameOver250ms === false ? [`${name} ${mode} 1st s ${timeline[mode].play?.firstSecondFps} of ${timeline[mode].play?.settledFps} fps`] : [])));
  const linkFirst = tasks?.play === undefined ? '' : ` · phone link 1st s ${tasks.play.firstSecondFps} of ${tasks.play.settledFps} fps`;
  out.push(row('DL24', runs.length === 0 ? null : first.length === 0, `${first.length === 0 ? 'steady from second 1 on the Simulator' : list(first)}${linkFirst}`));

  const moved = seven.flatMap(([name, gate]) => { const read = requestsOf(gate)?.spawnRereads; return read === undefined || read.files === 0 ? [] : [`${name} ${read.files} files ${(read.bytes / 1e6).toFixed(2)} MB`]; });
  out.push(row('DL25', seven.length === 0 ? null : moved.length === 0, moved.length === 0 ? `0 bytes re-read of spawn-set parts on ${seven.length} flows` : `re-read: ${list(moved)}`));
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [out] = process.argv.slice(2);
  if (!out) { console.error('usage: sweep-report.mjs <out>'); process.exit(2); }
  const about = json(join(out, 'sweep.json')), result = rows(readSweep(out), about);
  writeFileSync(join(out, 'report.json'), `${JSON.stringify({ ...about, rows: result }, null, 1)}\n`);
  console.log(`DOWNLOAD sweep: ${about?.build ?? out}${about?.workerRow === 1 ? ' (J130 row)' : ''}`);
  for (const line of result) console.log(`${line.id.padEnd(5)} ${line.state.padEnd(8)} ${line.text}`);
  process.exit(result.every(line => line.state === 'PASS') ? 0 : 1);
}
