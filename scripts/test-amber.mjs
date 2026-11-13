// J295 (Jake, 2026-11-12): a CI test file over its time budget is AMBER, not red. "Shouldn't fail the release
// process. But warnings are trivially ignored, and it will lead to a bleed." The job stays green and says AMBER; a
// hang and an ignored amber still go red. Every threshold lives here, in AMBER below.
//
// The ledger is the `amber` map in the measured timings table (scripts/test-timings.mjs, Actions cache): main's
// timings job adds each run's over-budget files to it and drops a file the run measured under budget, so every
// later run (main and plan branches alike) reads how long and how many main runs each file has been amber.
// Node built-ins only: main's timings job runs this with no install.

export const AMBER=Object.freeze({
  /** The per-file budget (J193): a file over it is AMBER. */
  budgetMs:60_000,
  /** A file at this many times its budget or more is red at once: a real hang still fails. */
  redFactor:2,
  /** Amber on main this long (since its first amber main run) turns red: an amber is fixed the same day. */
  redAfterHours:24,
  /** Amber on this many main runs in a row turns the next over-budget run red (~3 h at 2026-11-12's ~4 runs/h). */
  redAfterRuns:12,
  /** A streak ends only after this many main runs in a row within budget, so a file hovering at 60 s still escalates. */
  clearAfterRuns:3,
});

/** @typedef {{since:number,runs:number,ms:number,run:string,clean?:number}} AmberEntry one file's amber streak on main;
 * `clean` counts the main runs in a row since its last amber that measured it within budget */
/** @typedef {Record<string,AmberEntry>} AmberLedger */
/** @typedef {{file:string,ms:number,budget:number,level:'ok'|'amber'|'red',why:string,entry?:AmberEntry}} Verdict */

/** The valid entries of a stored ledger; anything else (none yet, a broken entry) is dropped, never the whole ledger.
 * @param {unknown} value @returns {AmberLedger} */
export function readLedger(value){
  if(value===null||typeof value!=='object'||Array.isArray(value))return {};
  return Object.fromEntries(Object.entries(value).filter(([,row])=>row!==null&&typeof row==='object'&&Number.isFinite(row.since)
    &&Number.isSafeInteger(row.runs)&&row.runs>0&&Number.isFinite(row.ms)&&typeof row.run==='string'));
}

/** One file's verdict against its budget and its streak so far. Pure.
 * @param {string} file @param {number} ms @param {number} budget @param {AmberEntry|undefined} entry @param {number} now
 * @param {typeof AMBER} [limits] @returns {Verdict} */
export function judgeFile(file,ms,budget,entry,now,limits=AMBER){
  const base={file,ms:Math.round(ms),budget,...(entry===undefined?{}:{entry})};
  if(ms<=budget)return {...base,level:'ok',why:'within budget'};
  if(ms>=budget*limits.redFactor)return {...base,level:'red',why:`at ${limits.redFactor}x its budget or more`};
  if(entry!==undefined&&entry.runs>=limits.redAfterRuns)return {...base,level:'red',why:`amber on ${entry.runs} main runs in a row`};
  if(entry!==undefined&&now-entry.since>=limits.redAfterHours*3_600_000)return {...base,level:'red',why:`amber on main since ${new Date(entry.since).toISOString()}, over ${limits.redAfterHours} h`};
  return {...base,level:'amber',why:entry===undefined?'first amber':`amber on ${entry.runs} main runs since ${new Date(entry.since).toISOString()}`};
}

/** The machine-readable line (and a GitHub annotation's message) for an amber or red verdict.
 * @param {Verdict} verdict @param {string|null|undefined} run */
export const amberLine=(verdict,run)=>
  `${verdict.level==='red'?'RED':'AMBER'} file=${verdict.file} ms=${verdict.ms} budget=${verdict.budget} run=${run??'local'} streak=${verdict.entry?.runs??0} why=${verdict.why.replaceAll(' ','_')}`;

/** Every AMBER line in some text (annotations, a log), one per file.
 * @param {string} text @returns {{file:string,ms:number,budget:number}[]} */
export function parseAmber(text){
  const out=new Map();
  for(const match of text.matchAll(/\bAMBER file=(\S+) ms=(\d+) budget=(\d+)/gu))out.set(match[1],{file:match[1],ms:Number(match[2]),budget:Number(match[3])});
  return [...out.values()];
}

/** The ledger after one main run measured `files`: an over-budget file extends (or starts) its streak, a file
 * measured within budget on `clearAfterRuns` main runs in a row leaves, an unmeasured one keeps its entry, and a file outside `inventory` (the full
 * ring's whole suite; null for Ring 1, which runs only part of it) leaves. Pure.
 * @param {AmberLedger|undefined} previous @param {readonly {file:string,durationMs:number}[]} files
 * @param {{run:string,at:number,inventory:Set<string>|null,budget?:number}} options @returns {AmberLedger} */
export function nextLedger(previous,files,options){
  const budget=options.budget??AMBER.budgetMs,next=/** @type {AmberLedger} */({});
  const kept=(/** @type {string} */file)=>options.inventory===null||options.inventory.has(file);
  for(const [file,entry] of Object.entries(previous??{}))if(kept(file))next[file]=entry;
  // One measurement per file, its slowest, so a retried attempt never counts twice.
  const slowest=new Map();
  for(const row of files)if(kept(row.file))slowest.set(row.file,Math.max(slowest.get(row.file)??0,row.durationMs));
  for(const [file,ms] of slowest){
    const old=next[file];
    if(ms<=budget){
      if(old===undefined)continue;
      const clean=(old.clean??0)+1;
      if(clean>=AMBER.clearAfterRuns)Reflect.deleteProperty(next,file);else next[file]={...old,clean};
      continue;
    }
    next[file]={since:old?.since??options.at,runs:(old?.runs??0)+1,ms:Math.round(ms),run:options.run,clean:0};
  }
  return next;
}

/** A shard's five-minute wall (J193) under the same rule (EV3c, J295): over it is AMBER, at `redFactor` times it red, and
 * the job stays green on an amber. No streak: shard numbers change with every plan, so a wall amber can't be followed
 * from run to run; the files that made it slow carry their own. Pure.
 * @param {string} shard @param {number} ms @param {number} budget @param {typeof AMBER} [limits] @returns {Verdict} */
export const judgeWall=(shard,ms,budget,limits=AMBER)=>judgeFile(`shard-${shard}-wall`,ms,budget,undefined,0,limits);

/** AUDIO AU6 (J303): every shard-audio AMBER line in some text (`audioAmberLine` in src/cook/game/audioReport.ts, which
 * CI's budget reporter annotates), one per shard and tier. Never red on main: `level=red` says only how far over (J295).
 * @param {string} text @returns {{shard:string,tier:string,bytes:number,budget:number,red:number,level:string}[]} */
export function parseAudioAmber(text){
  const out=new Map();
  for(const match of text.matchAll(/\bAMBER audio shard=(\S+) tier=(\S+) bytes=(\d+) budget=(\d+) red=(\d+) level=(\S+)/gu))
    out.set(`${match[1]} ${match[2]}`,{shard:match[1],tier:match[2],bytes:Number(match[3]),budget:Number(match[4]),red:Number(match[5]),level:match[6]});
  return [...out.values()];
}
