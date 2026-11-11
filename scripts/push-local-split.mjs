// DEV-SPEED DS9 (J222): the queue's pre-push runs static checks, the related
// Vitest files and the declared native files; hosted Linux CI runs the full
// suite, browser files, timing files and every file over the local budget.
import {execFileSync} from 'node:child_process';
import {appendFileSync,mkdirSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,resolve} from 'node:path';
import {readWeights} from './test-timings.mjs';
import {CI_SERIAL_TESTS,CPU_EXCLUSIVE_TESTS} from './vitest-ci-files.ts';

/** Q54: a related file over this many seconds alone runs on hosted CI only. */
export const LOCAL_FILE_SECONDS=20;
/** Vitest files that drive a real browser. Playwright e2e is already hosted-only. */
export const BROWSER_TESTS=Object.freeze(/** @type {string[]} */(['test/chromium-memory-browser.test.ts','test/headless-combat.test.ts','test/javelin-flight.test.ts',
 'test/net-strip-browser.test.ts','test/projectile-law.test.ts','test/tooling/chrome-keychain.test.mjs','test/tooling/parity/browser-escape.test.mjs']));
/** Wall-clock proofs that hold the whole CPU budget (vitest-ci-files.ts). */
export const TIMING_TESTS=Object.freeze(/** @type {string[]} */([...CPU_EXCLUSIVE_TESTS]));
/** The repo's declared native (Rust/Python/C child) integration files. */
export const NATIVE_TESTS=Object.freeze(/** @type {string[]} */([...CI_SERIAL_TESTS]));

/** Branch names a plan worktree pushes (J240): hosted branch CI gates its landing. */
export const PLAN_REF=/^refs\/heads\/plan\/[a-z0-9][a-z0-9._-]*$/u;

/** The pushed (non-deleting) remote refs of a pre-push ref list.
 * @param {string|undefined} refs */
export function pushedRefs(refs){
 return (refs??'').trim().split('\n').filter(Boolean).map(line=>line.trim().split(/\s+/u))
  .filter(([,local])=>!/^0+$/u.test(local??'')).map(([,local,remote,base])=>({local:local??'',remote:remote??'',base:base??''}));
}

/** The split is for pushes that hosted CI gates before or after they land:
 * a `plan/*` branch push (J240: its branch CI must be green before the
 * fast-forward merge), or a driver that sets WS_PUSH_POST_CI=1 because it
 * watches the exact SHA's hosted run after the push. A hand push to main,
 * a tag, a release and hosted CI itself keep the complete local gate.
 * @param {NodeJS.ProcessEnv} env @param {string|undefined} refs */
export function splitRequested(env,refs=env.WS_PUSH_REFS){
 if(env.CI||env.GITHUB_ACTIONS)return false;
 // No refs (a release check) or any tag/other branch keeps the complete gate.
 const pushed=pushedRefs(refs);
 if(pushed.length===0)return false;
 if(pushed.every(row=>PLAN_REF.test(row.remote)))return true;
 return env.WS_PUSH_POST_CI==='1'&&pushed.every(row=>row.remote==='refs/heads/main');
}

/** A first push of a plan branch has no remote tip. Select against the
 * branch's merge-base with origin/main instead of the whole tree; unknown
 * history keeps the zero base, which selects the conservative full mode.
 * @param {string|undefined} refs @param {string} [cwd] */
export function planBaseRefs(refs,cwd=process.cwd()){
 if(refs===undefined)return refs;
 return refs.split('\n').map(line=>{
  const fields=line.trim().split(/\s+/u);
  if(fields.length!==4||!PLAN_REF.test(fields[2]??'')||!/^0+$/u.test(fields[3]??'')||/^0+$/u.test(fields[1]??''))return line;
  try{
   const base=execFileSync('git',['merge-base',fields[1]??'','refs/remotes/origin/main'],{cwd,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
   return /^[a-f0-9]{40}$/u.test(base)?[fields[0],fields[1],fields[2],base].join(' '):line;
  }catch{return line;}
 }).join('\n');
}

/** Why a file runs on hosted CI only, or null when it stays local.
 * @param {string} file @param {Record<string,number>} seconds */
export function hostedOnlyReason(file,seconds){
 if(BROWSER_TESTS.includes(file))return 'browser';
 if(TIMING_TESTS.includes(file))return 'timing';
 const measured=seconds[file];
 if(measured!==undefined&&measured>LOCAL_FILE_SECONDS)return `over ${LOCAL_FILE_SECONDS} s (${measured.toFixed(1)} s)`;
 return null;
}

/** The local Vitest files for a split gate. Seconds come from main's last measured
 * run (scripts/test-timings.mjs, LS2); an unmeasured file stays local.
 * @param {{mode:'full'|'related'|'docs',tests?:string[]}} selection
 * @param {Record<string,number>} [seconds] */
export function splitLocalTests(selection,seconds=readWeights('full')){
 const candidates=selection.mode==='related'?selection.tests??[]:selection.mode==='full'?[...NATIVE_TESTS]:[];
 /** @type {string[]} */const local=[];/** @type {{file:string,reason:string}[]} */const hosted=[];
 for(const file of [...new Set(candidates)].sort()){
  const reason=hostedOnlyReason(file,seconds);
  if(reason===null)local.push(file);else hosted.push({file,reason});
 }
 return {local:local.sort(),hosted};
}

/** Q54: every file sent to hosted CI for being slow is logged for VITEST-BENCH.
 * @param {{file:string,reason:string}[]} hosted @param {{sha:string,lane?:string}} context
 * @param {string} [file] */
export function logHostedOnly(hosted,context,file=resolve(homedir(),'.cache/wildshard/vitest-bench/hosted-only.log')){
 const slow=hosted.filter(row=>row.reason.startsWith('over '));
 if(slow.length===0)return;
 try{
  mkdirSync(dirname(file),{recursive:true});
  appendFileSync(file,slow.map(row=>`${JSON.stringify({at:new Date().toISOString(),sha:context.sha,lane:context.lane??null,file:row.file,reason:row.reason})}\n`).join(''));
 }catch(error){console.error(`  !! hosted-only log unavailable: ${error instanceof Error?error.message:String(error)}`);}
}
