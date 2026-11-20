#!/usr/bin/env node
// DF6 / J464. One browser at a time on the mini.
// node scripts/fps/table.mjs --zone driftwood-isle [--profiles NAME,...] [--runs 3] [--base ORIGIN]
// --dock-only --cold-only is a short diagnostic. The full matrix includes both desktop sizes and a warm repeat.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { capFor, readCaps } from '../budgets/files.mjs';
import { routeFor } from '../memory/iphone/route.mjs';

/** @typedef {Omit<Parameters<typeof import('./measure.mjs').measureFps>[0], 'cpu' | 'floor'> & {factor:string|null}} ProfileSpec */
const PHONE = /** @type {const} */ ({ browser: 'chromium', tier: 'phone', width: 402, height: 812, dpr: 3 });
const DESKTOP = /** @type {const} */ ({ browser: 'chromium', tier: 'desktop', cap: null });
const displays = /** @type {const} */ ([{ width: 1496, height: 717, dpr: 2 }, { width: 1920, height: 1080, dpr: 1 }]);
/** @param {(typeof displays)[number]} display @param {'low'|'high'} graphics @param {string|null} factor
 * @returns {ProfileSpec} */
function desktop(display, graphics, factor) {
  return { ...DESKTOP, ...display, graphics, factor, tier: graphics === 'low' ? 'phone' : 'desktop' };
}
/** @type {Record<string, ProfileSpec[]>} */
const profiles = {
  'phone-lpm-low': [{ ...PHONE, graphics: 'low', cap: 30, factor: 'phoneLpm' }],
  'phone-high': [{ ...PHONE, graphics: 'high', cap: 60, factor: 'phoneNormal' }],
  'phone-low': [{ ...PHONE, graphics: 'low', cap: 60, factor: 'phoneNormal' }],
  'desktop-high': displays.map(display => desktop(display, 'high', 'desktopTypical')),
  'desktop-native': displays.flatMap(display => [desktop(display, 'high', null), desktop(display, 'low', null)]),
};
const root = resolve(import.meta.dirname, '../..');
const lock = join(homedir(), 'projects/games/wildshard/engine/tmp/mini-measure.lock');
const marker = join(homedir(), '.cache/wildshard/jake-playing');
const exclusiveGPU = '^/.*(ms-playwright|[.]agent-browser/browsers)/.*(chrome-headless-shell|Chromium|Chrome for Testing|MiniBrowser|Playwright|WebKit[.]GPU[.]Development)( |$)';
const keys = Object.keys(profiles);
const choices = parseArgs({ options: {
  zone: { type:'string', default:'driftwood-isle' }, profiles:{ type:'string', default:keys.join(',') },
  runs:{ type:'string', default:'3' }, base:{ type:'string', default:'https://staging.wildshard.io/' }, out:{ type:'string' },
  'dock-only':{ type:'boolean' }, 'cold-only':{ type:'boolean' }, 'dry-run':{ type:'boolean' }, 'worker':{ type:'string' },
} }).values;

function assertIdle() {
  if (existsSync(marker)) throw new Error('Jake is playing');
  try {
    const active = execFileSync('/usr/bin/pgrep',['-f',exclusiveGPU],{encoding:'utf8'}).trim();
    if (active) throw new Error(`Another browser owns GPU processes ${active}`);
  } catch (error) {
    if (typeof error !== 'object' || error === null || !('status' in error) || error.status !== 1) throw error;
  }
}

function model() { return execFileSync('/usr/sbin/sysctl',['-n','hw.model'],{encoding:'utf8'}).trim(); }
const bookPath = join(root,'budgets/fps-calibration.json');
const calibration = existsSync(bookPath) ? JSON.parse(readFileSync(bookPath,'utf8')) : { hosts:{} };
const route = [...routeFor('driftwood-fps')].slice(0,choices['dock-only'] ? 1 : undefined);
const order = new Map([['pass',0],['miss',2],['incomplete',3]]);
const show = (/** @type {number|null|undefined} */ x) => x === null || x === undefined ? '—' : x.toFixed(1);

/** @param {any[]} runs */
function table(runs) {
  const heading = '| Profile | Floor | fps | p50 ms | p95 ms | max ms | >50/min | Phone GPU ms | Worst segment | Verdict |';
  const rows = keys.filter(key => runs.some(run=>run.name===key)).map(name => {
    const set = runs.filter(run=>run.name===name);
    const worst = set.reduce((a,b) => (order.get(b.cold.verdict)??3) > (order.get(a.cold.verdict)??3) ||
      b.cold.verdict===a.cold.verdict && (b.cold.overall?.worst??Infinity)>(a.cold.overall?.worst??Infinity) ? b : a);
    const data = worst.cold, m = data.overall?.metrics;
    const calibrationStatus = worst.profile.calibrated ? '' : ' (CPU provisional)';
    return `| ${name} | ${worst.profile.floor} | ${show(m?.fps)} | ${show(m?.p50)} | ${show(m?.p95)} | ${show(m?.max)} | ${show(m?.spikesPerMinute)} | — | ${data.worstSegment ?? '—'} | ${data.verdict}${calibrationStatus} |`;
  });
  return [heading,'|---|---:|---:|---:|---:|---:|---:|---:|---|---|',...rows].join('\n');
}

/** @param {string} description */
async function worker(description) {
  const { profile, base, zone, warm, output } = JSON.parse(description);
  assertIdle();
  const stop = new AbortController();
  const interrupt = () => stop.abort(new Error('measurement interrupted'));
  const playing = setInterval(() => { if (existsSync(marker)) stop.abort(new Error('Jake is playing')); },150);
  process.once('SIGINT',interrupt); process.once('SIGTERM',interrupt);
  try {
    const {measureFps} = await import('./measure.mjs');
    const report = await measureFps(profile,{base,zone,route,signal:stop.signal,warm});
    writeFileSync(output,JSON.stringify(report));
    return stop.signal.aborted ? 3 : 0;
  } finally { clearInterval(playing); process.removeListener('SIGINT',interrupt); process.removeListener('SIGTERM',interrupt); }
}

async function main() {
  const zone = choices.zone;
  if (zone !== 'driftwood-isle') throw new Error('DF2 defines a route for driftwood-isle');
  const selected = choices.profiles.split(',');
  const count = Number(choices.runs);
  if (!Number.isSafeInteger(count)||count<1||new Set(selected).size!==selected.length||selected.some(p=>!keys.includes(p)))
    throw new Error('Use a positive run count and a unique list of known profiles');
  const base = new URL(choices.base).href, host = model(), factors = calibration.hosts[host]?.factors ?? {};
  const out = resolve(choices.out ?? join('tmp/driftwood-fps',String(Date.now())));
  const caps = readCaps(root);
  const plan = selected.flatMap(name => profiles[name].map(spec => {
    const floor = capFor(caps, `fps/${name}/${zone}`);
    if (floor?.kind !== 'floor' || floor.hard === null) throw new Error(`Missing FPS floor for ${name}`);
    const cpu = spec.factor === null ? 1 : factors[spec.factor]?.factor ?? (spec.factor === 'desktopTypical' ? 2 : 1);
    if (!Number.isFinite(cpu) || cpu < 1) throw new Error(`Invalid CPU factor for ${name}`);
    return { name, profile:{...spec,cpu,floor:floor.hard,calibrated:spec.factor===null || spec.factor==='desktopTypical' || factors[spec.factor]?.qualified===true} };
  }));
  if (choices['dry-run']) { console.log(JSON.stringify({zone,base,out,host,count,plan,route},null,2)); return 0; }
  if (existsSync(marker)) throw new Error('Jake is playing');
  mkdirSync(out,{recursive:true}); mkdirSync(resolve(lock,'..'),{recursive:true});
  const started = Date.now(), runs = [];
  let stopped = false;
  for (const [i,{name,profile}] of plan.entries()) for (let rep=1;rep<=count;rep++) {
    if (stopped || existsSync(marker)) break;
    const output = join(out,`run-${i+1}-${rep}.json`);
    const description = JSON.stringify({profile,base,zone,warm:!choices['cold-only'] && rep===count,output});
    const args = ['-k',lock,join(root,'scripts/browser-lane.sh'),'--max','10',process.execPath,import.meta.filename,
      '--worker',description,...choices['dock-only']?['--dock-only']:[]];
    const child = spawn('/usr/bin/lockf',args,{stdio:'inherit'});
    const stop = () => { stopped = true; child.kill('SIGTERM'); };
    const playing = setInterval(() => { if (existsSync(marker)) stop(); },150);
    process.once('SIGINT',stop); process.once('SIGTERM',stop);
    const [status] = await once(child,'exit').finally(() => {
      clearInterval(playing);
      process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop);
    });
    const report = status === 0 ? JSON.parse(readFileSync(output,'utf8')) :
      { cold:{ verdict:'incomplete', error:`measurement exited ${status}` },warm:null };
    runs.push({name,profile,rep,...report});
    console.error(`${name} ${profile.width}×${profile.height} DPR ${profile.dpr}, ${profile.graphics}, #${rep}: ${report.cold.verdict}`);
    if (report.cold.error) console.error(report.cold.error);
  }
  const scope = choices['dock-only'] ? 'dock only' : 'full route';
  const builds = new Set(runs.flatMap(run => [run.cold.version?.build, run.warm?.version?.build].filter(Boolean)));
  const mixed = builds.size > 1;
  const markdown = [`## Driftwood FPS (${scope})`, '', table(runs), '',
    ...(mixed ? ['The served build changed between captures. Repeat on a pinned origin.'] : []),
    'Phone GPU estimates await DF5.'].join('\n');
  writeFileSync(join(out,'table.md'),`${markdown}\n`);
  writeFileSync(join(out,'table.json'),`${JSON.stringify({schema:1,host,base,zone,scope:choices['dock-only']?'dock':'route',seconds:(Date.now()-started)/1000,runs},null,1)}\n`);
  console.log(markdown);
  if (mixed || stopped || runs.length!==plan.length*count || runs.some(run=>run.cold.verdict==='incomplete'||run.warm?.verdict==='incomplete')) return 3;
  if (runs.some(run=>run.cold.verdict==='miss')) return 2;
  return runs.every(run=>run.profile.calibrated) ? 0 : 3;
}

try { process.exitCode = choices.worker ? await worker(choices.worker) : await main(); }
catch (error) { console.error(error); process.exitCode = 3; }
