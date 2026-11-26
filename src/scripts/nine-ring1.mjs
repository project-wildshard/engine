#!/usr/bin/env node
// NB6: full pinned Nine (not its Ring 1 server slice), stock standalone
// load-profile gate, NB1's phone street walk and the phone boot memory peak
// (meta MEMORY-GATES MG1, J408). No pin/baseline writes.
import {spawn} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve as resolvePath} from 'node:path';
import {serve} from './parity/serve.mjs';
import {assertNineLoad} from './loading-flow/nine-load.mjs';
import {browserPool} from './parity/pool.mjs';
import {holdCpu} from './cpu-admission.mjs';

const out = resolvePath('tmp/nine-ring1'), previewRoot = resolvePath(out, 'preview');
mkdirSync(out, {recursive:true});
/** @param {string[]} command @param {NodeJS.ProcessEnv} [env] */
async function run(command, env = process.env) {
  const child = spawn(command[0], command.slice(1), {stdio:'inherit', env});
  const code = await new Promise((resolve,reject) => {child.once('error',reject);child.once('close',resolve);});
  if (code !== 0) throw new Error(`Nine ring-1 command exited ${String(code)}: ${command.join(' ')}`);
}
const phase = process.argv[2] ?? 'all';
if (!['build','boot','bench','memory','measure','ledger','diagnose-ledger-nine','all'].includes(phase)) throw new Error('Usage: nine-ring1.mjs build|boot|bench|memory|measure|ledger|diagnose-ledger-nine|all');
if (phase === 'build' || phase === 'all') {
  await run([process.execPath, 'src/scripts/pins.ts', 'install', 'brasscap-mesa', 'nine-dragon-stack']);
  const catalogue = JSON.parse(readFileSync('test/pins/catalogue.json','utf8'));
  const kept = new Set(['brasscap-mesa','nine-dragon-stack']);
  catalogue.shards = catalogue.shards.filter((/** @type {{slug:string}} */ row) => kept.has(row.slug));
  catalogue.placements = catalogue.placements.filter((/** @type {{slug:string}} */ row) => kept.has(row.slug));
  catalogue.grid.cells = catalogue.grid.cells.map((/** @type {{slug:string}} */ row) => kept.has(row.slug) ? row : {...row,slug:'brasscap-mesa',speedClass:'road'});
  const file = resolvePath(out,'catalogue.json'); writeFileSync(file,JSON.stringify(catalogue));
  await run([process.execPath,'src/scripts/gen.mjs','--inputs-only'], {...process.env,WILDSHARD_CATALOGUE:file});
  await run(['python3','src/scripts/heavy-lane.py','build','--',process.execPath,'src/scripts/build-app.mjs','--mode','preview','--outDir',resolvePath(previewRoot,'dist')],
    {...process.env,WILDSHARD_CATALOGUE:file});
}
if (phase !== 'build') {
  const preview = await serve(previewRoot,'',true);
  try {
    if (phase === 'boot' || phase === 'all') {
      const folder = resolvePath(out,'boot');mkdirSync(folder,{recursive:true});
      const cpu = await holdCpu(1,{inherit:true});
      const pool = browserPool(process.cwd(),1,process.platform === 'darwin' ? 'metal' : 'swiftshader');
      try {
        await assertNineLoad(await pool.browser(0),preview.url,folder);
      } finally {try {await pool.close();} finally {await cpu.release();}}
    }
    if (phase === 'bench' || phase === 'all') {
      const bench = [process.execPath,'src/scripts/loading-flow/benchmax.mjs','--base',preview.url,
        '--route','nine','--seconds','60','--throttle','4','--dpr','2','--ratchet','--json',resolvePath(out,'street.json')];
      await run(process.platform === 'darwin' ? ['bash','src/scripts/browser-lane.sh',...bench] : bench);
    }
    if (phase === 'memory' || phase === 'all') {
      const probe = [process.execPath,'src/scripts/boot-memory-peak.mjs',`--url=${preview.url}`,'--chunk=nine-dragon-stack',`--out=${resolvePath(out,'memory.json')}`];
      await run(process.platform === 'darwin' ? ['bash','src/scripts/browser-lane.sh',...probe] : probe);
    }
    // ENGINE-MEMORY EM12, report-only (ci-reports): (b) native WebKit kernel footprints for Brasscap (the template since
    // J434) and Nine, three cold runs each, with EM11's phone chain; (a) the ledger [L] at control and peak for Brasscap.
    // Each appends its table to the step summary when GITHUB_STEP_SUMMARY is set.
    const summary = process.env.GITHUB_STEP_SUMMARY ? [`--summary=${process.env.GITHUB_STEP_SUMMARY}`] : [];
    if (phase === 'measure') {
      /** @type {string[]} */ const failed = [];
      for (const chunk of ['brasscap-mesa','nine-dragon-stack']) {
        const measure = [process.execPath,'src/scripts/memory/measure.mjs',`--url=${preview.url}`,`--chunk=${chunk}`,'--runs=3','--timeout=480',
          `--out=${resolvePath(out,`measure-${chunk}.json`)}`,...summary];
        try {await run(process.platform === 'darwin' ? ['bash','src/scripts/browser-lane.sh',...measure] : measure);} catch (error) {failed.push(String(error));}
      }
      if (failed.length > 0) throw new Error(failed.join('; '));
    }
    if (phase === 'diagnose-ledger-nine') {
      await run([process.execPath,'src/scripts/memory/measure.mjs',`--url=${preview.url}`,'--chunk=nine-dragon-stack',
        '--ledger-only','--observe-timeout','--timeout=180',`--out=${resolvePath(out,'ledger-nine-diagnostic.json')}`]);
    }
    if (phase === 'ledger') {
      await run([process.execPath,'src/scripts/memory/measure.mjs',`--url=${preview.url}`,'--chunk=brasscap-mesa','--ledger-only','--timeout=480',
        `--out=${resolvePath(out,'ledger-brasscap-mesa.json')}`,...summary]);
    }
  } finally {preview.close();await preview.closed;}
}
