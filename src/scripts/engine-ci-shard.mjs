import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {readEnginePlan,discoverEngineTests} from './engine-ci-plan.ts';
import * as v from 'valibot';

const plan=readEnginePlan(process.env.WS_CI_PLAN??'tmp/engine-ci/plan.json');
readEnginePlan(process.env.WS_CI_PLAN??'tmp/engine-ci/plan.json',discoverEngineTests(plan.ring));
const index=Number(process.env.WS_CI_SHARD),shard=plan.shards[index-1];
if(shard===undefined)throw new Error('Missing matrix shard');
const started=Date.now();let failed=false;
mkdirSync('tmp/engine-ci',{recursive:true});
// TS8: warm the selected browser once outside the file's native deadlines.
// Its I/O remains charged to this shard, including the final wall check.
const warmStarted=Date.now();
const chrome=shard.native.includes('src/test/parity/browser-escape.test.mjs')
  ?await import('./warm-native-chrome.mjs').then(({nativeChromeExecutable,warmNativeChrome})=>warmNativeChrome(nativeChromeExecutable())):null;
if(chrome!==null)console.log(JSON.stringify({preparation:'native Chrome files read',shard:index,milliseconds:Date.now()-warmStarted,bytes:chrome.bytes}));
for(const phase of /** @type {const} */ (['native','ordinary'])){
  if(shard[phase].length===0)continue;
  const report=resolve(`tmp/engine-ci/shard-${index}-${phase}.json`);
  /** @type {NodeJS.ProcessEnv} */ const env={...process.env,WS_CI_PHASE:phase,WS_CI_TIMINGS:report};
  if(chrome!==null){
    env.WS_CI_NATIVE_CHROME_WARM=chrome.executable;
    if(phase==='native')env.CHROME_PATH=chrome.executable;
  }
  else Reflect.deleteProperty(env,'WS_CI_NATIVE_CHROME_WARM');
  if(plan.ring==='1')env.WILDSHARD_RING='1';else Reflect.deleteProperty(env,'WILDSHARD_RING');
  const result=spawnSync('python3',['src/scripts/heavy-lane.py','full-test','--',process.execPath,'src/scripts/vitest-tmp.ts','run','--config','src/scripts/engine-ci.config.ts','--reporter=default','--reporter=./src/scripts/engine-ci-budget.ts'],{env,stdio:'inherit',timeout:300000});
  if(result.error!==undefined||result.status!==0)failed=true;
  // J295: the reporter judged each file; only a red one (2x its budget, or amber on main too long) fails the shard.
  const measured=v.parse(v.object({budget:v.object({red:v.array(v.string())}),files:v.array(v.object({file:v.string(),durationMs:v.number()}))}),JSON.parse(readFileSync(report,'utf8')));
  if(measured.budget.red.length>0)failed=true;
  const actual=measured.files.map(file=>file.file).sort(),expected=[...shard[phase]].sort();
  if(JSON.stringify(actual)!==JSON.stringify(expected))throw new Error('Executed shard membership differs from its exact plan');
}
const seconds=(Date.now()-started)/1000;
if(seconds>300){console.error(`::error::CI shard ${seconds.toFixed(1)} s exceeds 300 s`);failed=true;}
console.log(JSON.stringify({shard:index,files:shard.native.length+shard.ordinary.length,seconds,failed}));process.exitCode=failed?1:0;
