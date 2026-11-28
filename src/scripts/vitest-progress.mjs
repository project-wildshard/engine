// Meta QA 11-26 row 70: the full push gate's Vitest step hit STUCK at 900 s twice (release/v0.1.101) and said nothing
// about which file held it. This reporter appends one line per test file start and end to `WS_VITEST_PROGRESS`; the
// gate reads it when a Vitest step ends or is stopped and names the files still running and the slowest ones.
// Node built-ins only. Vitest loads the default export as a reporter: `--reporter=src/scripts/vitest-progress.mjs`.
import {appendFileSync,existsSync,readFileSync} from 'node:fs';
import {relative} from 'node:path';

/** A local file slower than this is named on every gate run (meta QA70; hosted CI keeps J295's own per-file budgets). */
export const SLOW_FILE_SECONDS=120;

/** Expected full-suite seconds on `workers` workers: the hosted timings table's per-file seconds over the workers.
 * @param {Record<string,number>|undefined} table @param {number} workers @returns {number|null} */
export function expectedSuiteSeconds(table,workers){
  if(table===undefined||!Number.isFinite(workers)||workers<1)return null;
  const values=Object.values(table);if(values.length===0)return null;
  return values.reduce((sum,seconds)=>sum+seconds,0)/workers;
}

export default class VitestProgress {
  constructor(){this.path=process.env.WS_VITEST_PROGRESS;this.root=process.cwd();}
  /** @param {{config:{root:string}}} vitest */
  onInit(vitest){this.root=vitest.config.root;}
  /** @param {{moduleId:string}} module @param {Record<string,unknown>} row */
  write(module,row){
    if(!this.path)return;
    try{appendFileSync(this.path,`${JSON.stringify({file:relative(this.root,module.moduleId).replaceAll('\\','/'),at:Date.now(),...row})}\n`);}catch{ /* progress is evidence only */ }
  }
  /** @param {{moduleId:string}} module */
  onTestModuleStart(module){this.write(module,{event:'start'});}
  /** @param {{moduleId:string,state:()=>string}} module */
  onTestModuleEnd(module){this.write(module,{event:'end',state:module.state()});}
}

/** Files still running and the slowest finished ones, from a progress file's text.
 * @param {string} text @param {number} [now] @param {number} [top]
 * @returns {{running:{file:string,seconds:number}[],slowest:{file:string,seconds:number}[],finished:number}} */
export function progressSummary(text,now=Date.now(),top=5){
  /** @type {Map<string,number>} */const started=new Map();/** @type {{file:string,seconds:number}[]} */const done=[];
  for(const line of text.split('\n')){
    if(!line.trim())continue;
    let row;try{row=JSON.parse(line);}catch{continue;}
    if(typeof row?.file!=='string'||typeof row.at!=='number')continue;
    if(row.event==='start')started.set(row.file,row.at);
    else if(row.event==='end'&&started.has(row.file)){done.push({file:row.file,seconds:(row.at-(started.get(row.file)??row.at))/1000});started.delete(row.file);}
  }
  const bySeconds=(a,b)=>b.seconds-a.seconds||a.file.localeCompare(b.file);
  return {running:[...started].map(([file,at])=>({file,seconds:(now-at)/1000})).sort(bySeconds),slowest:done.sort(bySeconds).slice(0,top),finished:done.length};
}

/** One line naming the files, or '' when there is no progress file. @param {string|undefined} path @param {number} [now] */
export function progressReport(path,now=Date.now()){
  if(!path||!existsSync(path))return '';
  const {running,slowest,finished}=progressSummary(readFileSync(path,'utf8'),now);
  const name=rows=>rows.map(row=>`${row.file} ${row.seconds.toFixed(0)} s`).join(', ');
  const slow=slowest.filter(row=>row.seconds>SLOW_FILE_SECONDS);
  return [`${finished} file(s) finished`,running.length>0?`still running: ${name(running.slice(0,5))}`:'',
    slowest.length>0?`slowest: ${name(slowest)}`:'',slow.length>0?`over ${SLOW_FILE_SECONDS} s: ${slow.map(row=>row.file).join(', ')}`:''].filter(Boolean).join('; ');
}
