#!/usr/bin/env node
// Chunk-param guard (meta CHUNK-PARAM-REMOVAL CP23, J522: `?chunk=` is deleted; no zone in any address). Goes red when a
// URL-shaped `chunk` comes back in the tree an engine page, tool or doc is made from:
//   (a) a query pair: `chunk=` right after `?`, `&`, a quote, a backtick or a parenthesis;
//   (b) a params call: `.get`, `.set`, `.has`, `.delete` or `.append` of the string `'chunk'` (a `searchParams`, a
//       `URLSearchParams` or any params object a page reads its address with).
// The music sting (`music.sting('chunk')`), Rollup's `type === 'chunk'` and `--chunk=` flags match neither, by construction.
// project/ (journals) and budgets/calibration-reports/ (recorded runs) are history and stay unread.
// The baseline (src/scripts/chunk-param-guard.baseline.json) holds today's files and their counts while M3 and CP22 remove
// them. It may only shrink: a new file, or a listed file with more than its count, fails; a smaller count passes and asks
// for `--prune`, which writes the lower counts. CP22 took it to zero: what is left is a test or a refusal proving an old
// link is ignored, each line marked `chunk-param-guard: old link`.
// It also prints the one-shard page's mode branches left in entry.ts, oneWayIn.ts and pageEntry.ts (the plan's Q2).
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

// The lean layout (repo-kit, 11-26) moves scripts/ to src/scripts/: the root is git's, the baseline sits beside this file, and
// a path is judged by its key with that move undone, so the move itself is never a new offender.
const ROOT=execFileSync('git',['rev-parse','--show-toplevel'],{cwd:import.meta.dirname,encoding:'utf8'}).trim();
const BASELINE_FILE=join(import.meta.dirname,'chunk-param-guard.baseline.json');
const SCOPE=['src','index.html','public','scripts','test','.agents','docs'];
// test/parity/baselines/ and the phone-loading fixture are recorded runs, history like the calibration reports.
const SKIP=['project/','budgets/calibration-reports/','test/parity/baselines/','test/fixtures/phone-loading-a6701db71.json'];
const SELF=new Set(['scripts/chunk-param-guard.mjs','scripts/chunk-param-guard.d.mts','scripts/chunk-param-guard.baseline.json','test/chunk-param-guard.test.ts','src/test/chunk-param-guard.test.ts', // script-paths: guardKey's keys keep the old spelling
  // CP22's proof that an old link is ignored carries one on purpose
  'src/e2e/t1/old-link.ts']);
/** A path's baseline key: `src/scripts/x` is `scripts/x` (the lean layout's move). @param {string} path */
export function guardKey(path){return path.replace(/^src\/scripts\//u,'scripts/');} // script-paths: the old spelling is the key
const TEXT=/\.(?:[cm]?[jt]sx?|mts|json|html|md|sh|py|ya?ml|txt|css)$/u;
const PAIR=/[?&'"`(]chunk=(?![=>])/gu; // never `(chunk===` or `(chunk=>`, a variable named chunk
const CALL=/\.(?:get|set|has|delete|append)\(\s*['"`]chunk['"`]/gu;
const ONE_SHARD=['src/client/app/entry.ts','src/client/game/grid/oneWayIn.ts','src/client/game/grid/pageEntry.ts'];
const MODE_BRANCH=/[!=]==\s*'(?:grid|shard|shardfile)'/gu;

/** CP22: a line that proves an old link is ignored or refused carries the param on purpose, and says so with this mark. */
export const OLD_LINK='chunk-param-guard: old link';

/** How many URL-shaped `chunk` reads and writes a text carries (a marked line is not counted). @param {string} text */
export function chunkParamCount(text){
  return text.split('\n').filter(line=>!line.includes(OLD_LINK)).reduce((sum,line)=>sum+(line.match(PAIR)?.length??0)+(line.match(CALL)?.length??0),0);
}

/** Every file in scope that carries one, with its count. @param {{ paths: string[], read: (path: string) => string }} input */
export function chunkParamOffenders({paths,read}){
  /** @type {Record<string, number>} */
  const found={};
  for(const path of [...paths].sort()){
    if(SELF.has(guardKey(path))||SKIP.some(prefix=>path.startsWith(prefix)))continue;
    if(!SCOPE.some(prefix=>path===prefix||path.startsWith(`${prefix}/`)))continue;
    if(!TEXT.test(path))continue;
    let text;
    try{text=read(path);}catch{continue;}
    const count=chunkParamCount(text);
    if(count>0)found[guardKey(path)]=count;
  }
  return found;
}

/** Compare with the shrink-only baseline. @param {Record<string, number>} found @param {Record<string, number>} baseline */
export function judge(found,baseline){
  const added=Object.keys(found).filter(path=>found[path]>(baseline[path]??0)).map(path=>`${path} (${found[path]}, baseline ${baseline[path]??0})`);
  const shrunk=Object.keys(baseline).filter(path=>(found[path]??0)<baseline[path]);
  return {added,shrunk};
}

/** The one-shard page's mode branches left (Q2): page-mode and path comparisons in its three files. @param {(path: string) => string} read */
export function oneShardBranches(read){
  return ONE_SHARD.reduce((sum,path)=>{
    try{return sum+(read(path).match(MODE_BRANCH)?.length??0);}catch{return sum;}
  },0);
}

if(process.argv[1]!==undefined&&import.meta.filename===process.argv[1]){
  const paths=execFileSync('git',['ls-files','-z','--',...SCOPE],{cwd:ROOT,encoding:'utf8',maxBuffer:64<<20}).split('\0').filter(Boolean);
  const read=(/** @type {string} */ path)=>readFileSync(join(ROOT,path),'utf8');
  const found=chunkParamOffenders({paths,read});
  const baselinePath=BASELINE_FILE;
  /** @type {Record<string, number>} */
  const baseline=existsSync(baselinePath)?JSON.parse(readFileSync(baselinePath,'utf8')).files:{};
  const {added,shrunk}=judge(found,baseline);
  const total=Object.values(found).reduce((sum,count)=>sum+count,0),branches=oneShardBranches(read);
  if(process.argv.includes('--prune')||process.argv.includes('--write')){
    /** @type {Record<string, number>} */
    const files={};
    for(const path of Object.keys(found).sort())if(process.argv.includes('--write')||baseline[path]!==undefined)files[path]=Math.min(found[path],baseline[path]??found[path]);
    writeFileSync(baselinePath,`${JSON.stringify({about:'CHUNK-PARAM-REMOVAL CP23: files that still read or write ?chunk=, with counts; shrink only (node src/scripts/chunk-param-guard.mjs --prune). CP22 takes it to zero.',files},null,1)}\n`);
    console.log(`chunk-param-guard: baseline written, ${Object.keys(files).length} files`);
  }else if(shrunk.length>0){
    console.log(`chunk-param-guard: ${shrunk.length} file(s) carry fewer than the baseline; run node src/scripts/chunk-param-guard.mjs --prune and commit the baseline`);
  }
  if(added.length>0&&!process.argv.includes('--write')){
    console.error(`chunk-param-guard (J522): \`?chunk=\` is deleted; a page enters a zone by its tap, its tab's handoff or a record, never its address (harness: enterZone). New reads or writes:\n${added.map(line=>`  ${line}`).join('\n')}`);
    process.exitCode=1;
  }
  if(process.exitCode!==1)console.log(`chunk-param-guard: ${total} in ${Object.keys(found).length} baselined file(s), none new; one-shard page mode branches left: ${branches}`);
}
