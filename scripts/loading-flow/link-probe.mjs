#!/usr/bin/env node
// DL10: what each entry program costs to link in Safari on the iPhone Simulator, cold. The Sim's GPU process links one
// program at a time (the 11-04 confirm pair: the baked early pass emptied the Shaders step but moved its seconds into
// Sky / Region world / Props), so the seconds are in particular programs; this names them.
// For each program in public/programs/<slug>.json (scripts/bake-entry-programs.mjs), on a fresh WebGL2 context in a
// Safari whose website data and caches were wiped and whose GPU process was restarted: compile + link, then one
// LINK_STATUS read (waits for the link), timed. A second pass in the same page times the same sources again (the GPU
// process's cache). Runs inside scripts/sim-lane.sh run ($SIM_UDID), as drive.mjs:
//   scripts/sim-lane.sh run --max 10 wildshard-loading node scripts/loading-flow/link-probe.mjs --base <preview URL> --out <file.json> <slug>...
// Prints the costliest programs per shard; <file.json> keeps every row (ms cold / cached, shader names, bytes).
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { soakInspector } from '../soak/inspector.mjs';

const args = process.argv.slice(2);
const opt = (name) => { const at = args.indexOf(`--${name}`); if (at === -1) return null; const [value] = args.splice(at, 2).slice(1); return value ?? null; };
const base = opt('base')?.replace(/\/$/u, ''), out = opt('out'), slugs = args;
if (!base || !out || slugs.length === 0) { console.error('usage: link-probe.mjs --base <url> --out <file.json> <slug>...'); process.exit(2); }
const udid = process.env.SIM_UDID;
if (!udid) { console.error('link-probe.mjs: run inside scripts/sim-lane.sh run (SIM_UDID unset)'); process.exit(2); }

const sock = execFileSync('xcrun', ['simctl', 'getenv', udid, 'RWI_LISTEN_SOCKET'], { encoding: 'utf8' }).trim();
const proxy = spawn('ios_webkit_debug_proxy', ['-s', `unix:${sock}`, '-c', 'null:9221,:9232-9240'], { stdio: 'ignore' });
process.on('exit', () => { try { proxy.kill(); } catch { /* already gone */ } });

/** Safari stopped (its GPU process with it) and its website data and caches wiped on disk, as drive.mjs's cold run. */
async function coldSafari() {
  try { execFileSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari'], { stdio: 'ignore' }); } catch { /* not running */ }
  await sleep(1500);
  const data = `${process.env.HOME}/Library/Developer/CoreSimulator/Devices/${udid}/data`;
  const wipe = (path) => { if (existsSync(path)) rmSync(path, { recursive: true, force: true }); };
  wipe(`${data}/Library/WebKit`); wipe(`${data}/Library/Caches/com.apple.mobilesafari`); wipe(`${data}/Library/Caches/com.apple.WebKit.Networking`);
  const apps = `${data}/Containers/Data/Application`;
  for (const id of existsSync(apps) ? readdirSync(apps) : []) {
    let ident = '';
    try { ident = execFileSync('plutil', ['-extract', 'MCMMetadataIdentifier', 'raw', `${apps}/${id}/.com.apple.mobile_container_manager.metadata.plist`], { encoding: 'utf8' }).trim(); } catch { /* no metadata */ }
    if (/mobilesafari|SafariViewService/iu.test(ident)) { wipe(`${apps}/${id}/Library/WebKit`); wipe(`${apps}/${id}/Library/Caches`); }
  }
}

/** The inspector of the page whose URL passes `test`, through the proxy's device ports. */
async function connect(test, ms = 90000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    for (let port = 9232; port <= 9240; port++) {
      try {
        const pages = await (await fetch(`http://127.0.0.1:${port}/json`, { signal: AbortSignal.timeout(500) })).json();
        const found = pages.find(row => typeof row.url === 'string' && test(row.url));
        if (found !== undefined) { const page = soakInspector(found.webSocketDebuggerUrl); await page.opened; await sleep(300); await page.evaluate('1'); return page; }
      } catch { /* not up yet */ }
    }
    await sleep(250);
  }
  throw new Error('no inspector page');
}

// In the page: both passes over the list, each program timed from createShader to its LINK_STATUS read.
const PROBE = (slug) => `async () => {
  const data = await (await fetch('/programs/${slug}.json', { cache: 'no-store' })).json();
  const text = at => data.shaders[at].map(line => data.lines[line]).join('\\n');
  const name = source => (source.match(/#define SHADER_NAME (.+)/) ?? source.match(/#define SHADER_TYPE (.+)/) ?? [, '?'])[1];
  const gl = document.createElement('canvas').getContext('webgl2');
  // as on the game's context: three enables extensions its shaders require (BatchedMesh: GL_ANGLE_multi_draw)
  for (const name of gl.getSupportedExtensions() ?? []) gl.getExtension(name);
  const pass = () => data.programs.map(([v, f]) => {
    const vs = text(v), fs = text(f), t = performance.now(), program = gl.createProgram();
    for (const [type, source] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
      const shader = gl.createShader(type); gl.shaderSource(shader, source); gl.compileShader(shader); gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    const ok = gl.getProgramParameter(program, gl.LINK_STATUS);
    return { ms: Math.round((performance.now() - t) * 10) / 10, ok, name: name(fs), vsBytes: vs.length, fsBytes: fs.length };
  });
  const cold = pass(), cached = pass();
  return { build: data.build, rows: cold.map((row, at) => ({ ...row, cachedMs: cached[at].ms })) };
}`;

const report = {};
for (const slug of slugs) {
  await coldSafari();
  execFileSync('xcrun', ['simctl', 'openurl', udid, `${base}/version.json`]);
  const page = await connect(url => url.startsWith(`${base}/version.json`));
  await page.evaluate(`window.__probe = null; (${PROBE(slug)})().then(v => { window.__probe = { v }; }, e => { window.__probe = { v: 'ERR ' + String(e) }; }); 1`);
  let result = 'timeout';
  for (const end = Date.now() + 300000; Date.now() < end;) {
    const value = await page.evaluate('window.__probe ? JSON.stringify(window.__probe.v) : null');
    if (value !== null) { result = JSON.parse(value); break; }
    await sleep(500);
  }
  page.close();
  report[slug] = result;
  if (typeof result === 'string') { console.log(`${slug}: ${result}`); continue; }
  const total = result.rows.reduce((sum, row) => sum + row.ms, 0), cached = result.rows.reduce((sum, row) => sum + row.cachedMs, 0);
  console.log(`${slug} (${result.build}): ${result.rows.length} programs, cold ${(total / 1000).toFixed(2)} s, cached ${(cached / 1000).toFixed(2)} s, failed links ${result.rows.filter(row => !row.ok).length}`);
  for (const row of [...result.rows].sort((a, b) => b.ms - a.ms).slice(0, 12)) console.log(`  ${String(row.ms).padStart(7)} ms  cached ${String(row.cachedMs).padStart(6)} ms  ${row.name}  (vs ${row.vsBytes} B, fs ${row.fsBytes} B)`);
}
writeFileSync(out, `${JSON.stringify(report, null, 1)}\n`);
process.exit(0);
