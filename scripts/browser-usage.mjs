// Read-only machine usage; CPU ledger writes are atomic renames.
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {cpuRoot} from './cpu-admission.mjs';

export function browserStatus(){
 /** @type {{browser?:boolean,holder?:number}[]} */let rows=[];
 try{
  /** @type {{cpuActive?:{browser?:boolean,holder?:number}[]}} */const state=JSON.parse(readFileSync(resolve(cpuRoot(),'queue.json'),'utf8'));
  if(state.cpuActive!==undefined&&!Array.isArray(state.cpuActive))throw new Error('Invalid CPU ledger');
  rows=(state.cpuActive??[]).filter(row=>row.browser===true);
 }catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}
 // Snapshots are atomically renamed. Include physical roots outside this
 // ledger without exposing command lines or counting admitted roots twice.
 const processes=execFileSync('ps',['-axo','pid=,ppid=,command='],{encoding:'utf8',timeout:5000}).trim().split('\n').map(line=>{
  const match=/^\s*(\d+)\s+(\d+)\s+(.+)$/u.exec(line);
  return{pid:Number(match?.[1]),parent:Number(match?.[2]),command:match?.[3]??''};
 });
 const parents=new Map(processes.map(row=>[row.pid,row.parent]));
 const admitted=new Set(rows.map(row=>row.holder));
 /** @type {number[]} */const outside=[];
 for(const row of processes){
  if(!/^\/[^ ]*\/(?:ms-playwright|\.agent-browser\/browsers)\/.*\/(?:chrome-headless-shell|Chromium|chrome|Google Chrome for Testing)(?:\s|$)/u.test(row.command)||row.command.includes('--type='))continue;
  let pid=row.pid,owned=false;
  for(let depth=0;pid>1&&depth<64;depth++){
   if(admitted.has(pid)){owned=true;break;}
   pid=parents.get(pid)??0;
  }
  if(!owned)outside.push(row.pid);
 }
 return{total:rows.length+outside.length,holders:rows.flatMap(row=>typeof row.holder==='number'?[row.holder]:[]),outside};
}

export function browserUsage(){return browserStatus().total;}
