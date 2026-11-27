// Read-only machine usage; CPU ledger writes are atomic renames.
// DS20c (meta FLOW-SIMPLE FS17, J443): browser slots are free cores / 4, recomputed on every read, in place of J402's
// fixed two. Each browser reserves four cores in the CPU ledger; one open outside the ledger is charged four too.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {availableParallelism} from 'node:os';
import {resolve} from 'node:path';
import {cpuRoot} from './cpu-admission.mjs';

/** Cores one headless browser reserves (J402). */
export const BROWSER_CORES=4;

/** @typedef {{token?:string,slots?:number,borrowedFrom?:string|null,browser?:boolean,browserWeight?:number,holder?:number}} LedgerRow */

/** Cores the ledger holds: cpu-admission.py's reserved_slots. A borrowed grant is covered by its root's slots; a
 * root's browsers count when they weigh more. @param {readonly LedgerRow[]} active @returns {number} */
export function reservedSlots(active){
 const tokens=new Map(active.map(row=>[row.token,row]));
 /** @type {Map<string|undefined,number>} */const roots=new Map(),weights=new Map();
 for(const row of active){
  let cursor=row;const seen=new Set();
  while(typeof cursor.borrowedFrom==='string'&&tokens.has(cursor.borrowedFrom)&&!seen.has(cursor.token)){seen.add(cursor.token);cursor=/** @type {LedgerRow} */(tokens.get(cursor.borrowedFrom));}
  roots.set(cursor.token,cursor.slots??0);
  if(row.browser===true)weights.set(cursor.token,(weights.get(cursor.token)??0)+(row.browserWeight??BROWSER_CORES));
 }
 let sum=0;for(const [token,slots] of roots)sum+=Math.max(slots,weights.get(token)??0);
 return sum;
}

/** How many browsers may be open at once now: those open plus one per four free cores.
 * @param {{capacity:number,active:readonly LedgerRow[],outside:number}} ledger @returns {number} */
export function browserSlots({capacity,active,outside}){
 const open=active.filter(row=>row.browser===true).length+outside;
 const free=capacity-reservedSlots(active)-outside*BROWSER_CORES;
 return open+Math.max(0,Math.floor(free/BROWSER_CORES));
}

export function browserStatus(){
 /** @type {LedgerRow[]} */let active=[];
 // cpu-admission.py's machine budget when no ledger exists yet: every core but two.
 let capacity=Math.max(1,availableParallelism()-2);
 try{
  /** @type {{cpuActive?:LedgerRow[],cpuCapacity?:number}} */const state=JSON.parse(readFileSync(resolve(cpuRoot(),'queue.json'),'utf8'));
  if(state.cpuActive!==undefined&&!Array.isArray(state.cpuActive))throw new Error('Invalid CPU ledger');
  active=state.cpuActive??[];
  if(Number.isSafeInteger(state.cpuCapacity)&&/** @type {number} */(state.cpuCapacity)>0)capacity=/** @type {number} */(state.cpuCapacity);
 }catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
 const rows=active.filter(row=>row.browser===true);
 // Snapshots are atomically renamed. Include physical roots outside this
 // ledger without exposing command lines or counting admitted roots twice.
 const snapshot=execFileSync('ps',['-axo','pid=,ppid=,comm='],{encoding:'utf8',timeout:5000});
 const processes=snapshot.trim().split('\n').flatMap(line=>{
  const match=/^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
  return match===null?[]:[{pid:Number(match[1]),parent:Number(match[2]),executable:match[3]??''}];
 });
 const parents=new Map(processes.map(row=>[row.pid,row.parent]));
 const admitted=new Set(rows.map(row=>row.holder));
 // Darwin supplies paths; Linux can truncate chrome-headless-shell to chrome-headless.
 const browserExecutable=/(?:^|\/)(?:Google Chrome for Testing|chrome-headless(?:-shell)?|chromium|chrome)$/iu;
 const candidates=processes.filter(row=>browserExecutable.test(row.executable)).map(row=>row.pid);
 let commands='';
 if(candidates.length>0){
  try{
   commands=execFileSync('ps',['-p',candidates.join(','),'-o','pid=,command='],{encoding:'utf8',timeout:5000});
  }catch(error){
   // ps exits 1 with no rows if every selected process has already exited.
   if(!(error instanceof Error&&'status'in error&&error.status===1&&'stdout'in error&&error.stdout==='')){
    throw new Error('Could not read arguments for browser processes');
   }
  }
 }
 // Chrome's Mac executable uses Contents/MacOS. Crashpad runs inside Contents/Frameworks.
 const browserRoot=/^\/[^ ]*\/(?:ms-playwright|\.agent-browser\/browsers)\/(?:[^/\s]+\/)*(?:Google Chrome for Testing\.app\/Contents\/MacOS\/Google Chrome for Testing|chrome-headless-shell|Chromium|chrome)(?:\s|$)/u;
 /** @type {number[]} */const outside=[];
 for(const line of commands.trim().split('\n')){
  const match=/^\s*(\d+)\s+(.+)$/u.exec(line),command=match?.[2]??'';
  if(match===null||!browserRoot.test(command)||command.includes('--type='))continue;
  const root=Number(match[1]);
  let pid=root,owned=false;
  for(let depth=0;pid>1&&depth<64;depth++){
   if(admitted.has(pid)){owned=true;break;}
   pid=parents.get(pid)??0;
  }
  if(!owned)outside.push(root);
 }
 return{total:rows.length+outside.length,slots:browserSlots({capacity,active,outside:outside.length}),holders:rows.flatMap(row=>typeof row.holder==='number'?[row.holder]:[]),outside};
}

export function browserUsage(){return browserStatus().total;}
