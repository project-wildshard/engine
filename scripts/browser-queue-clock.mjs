// Admission wait is outside a proof's active-time budget. Events carry no CPU
// capability, only a private task scope and a bounded wait interval.
import {constants,closeSync,fstatSync,mkdirSync,openSync,readFileSync,unlinkSync,writeSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';

const LIMIT=300000,MAX_BYTES=1048576;
/** @param {unknown} value @returns {value is {token:string,scope:string,at:number,waiting:boolean,kind?:'scope'|'lease'}} */
function event(value){return value!==null&&typeof value==='object'&&'token'in value&&typeof value.token==='string'&&'scope'in value&&typeof value.scope==='string'&&'at'in value&&typeof value.at==='number'&&Number.isFinite(value.at)&&'waiting'in value&&typeof value.waiting==='boolean'&&(!('kind'in value)||value.kind==='scope'||value.kind==='lease');}
/** Exclude only intervals when every running scope is waiting and none
 * owns an active lease. A queued sibling never pauses active work.
 * @param {{token:string,scope:string,at:number,waiting:boolean,kind?:'scope'|'lease'}[]} events
 * @param {number} from @param {number} now @param {string|readonly string[]} [scope] */
export function queuedMilliseconds(events,from,now,scope){
 const scopes=typeof scope==='string'?[scope]:scope??[...new Set(events.map(row=>row.scope))];
 const rows=events.filter(row=>scopes.includes(row.scope)).sort((a,b)=>a.at-b.at);
 /** @type {Map<string,{scope:string,start:number}>} */const waits=new Map();
 /** @type {Map<string,string>} */const leases=new Map();
 /** @type {Map<string,boolean>} */const active=new Map(scopes.map(name=>[name,true]));
 const points=[...new Set([from,now,...rows.flatMap(row=>row.kind===undefined&&row.waiting?[row.at,row.at+LIMIT]:[row.at])])].filter(at=>at>=from&&at<=now).sort((a,b)=>a-b);
 let index=0,total=0;
 for(let i=0;i<points.length-1;i++){
  const at=points[i]??from,next=points[i+1]??now;
  for(;index<rows.length;index++){
   const row=rows[index];if(row===undefined||row.at>at)break;
   if(row.kind==='scope'){active.set(row.scope,row.waiting);continue;}
   if(row.kind==='lease'){if(row.waiting)leases.set(row.token,row.scope);else leases.delete(row.token);continue;}
   if(row.waiting)waits.set(row.token,{scope:row.scope,start:row.at});else waits.delete(row.token);
  }
  const running=scopes.filter(name=>active.get(name)!==false);
  if(running.length>0&&running.every(name=>![...leases.values()].includes(name)&&[...waits.values()].some(wait=>wait.scope===name&&at<wait.start+LIMIT)))total+=next-at;
 }
 return total;
}
/** @param {string} path @param {number} flags */
function ownedFile(path,flags){
 const fd=openSync(path,flags+constants.O_NOFOLLOW);
 try{const info=fstatSync(fd);if(!info.isFile()||info.uid!==process.getuid?.()||(info.mode&0o077)!==0||info.size>MAX_BYTES)throw new Error('Invalid browser queue clock');return fd;}
 catch(error){closeSync(fd);throw error;}
}
/** @template {{release:()=>Promise<void>}} T @param {()=>Promise<T>} acquire @param {NodeJS.ProcessEnv} [env] */
export async function browserQueue(acquire,env=process.env){
 const path=env.WS_BROWSER_QUEUE_LOG,scope=env.WS_BROWSER_QUEUE_SCOPE;
 if(path===undefined||scope===undefined)return acquire();
 const token=randomUUID();
 /** @param {boolean} waiting @param {'lease'} [kind] */
 const write=(waiting,kind)=>{const fd=ownedFile(path,constants.O_WRONLY+constants.O_APPEND);try{writeSync(fd,`${JSON.stringify({token,scope,at:Date.now(),waiting,...(kind===undefined?{}:{kind})})}\n`);}finally{closeSync(fd);}};
 write(true);
 let lease;
 try{lease=await acquire();}catch(error){write(false);throw error;}
 try{write(true,'lease');write(false);return{...lease,release:async()=>{await lease.release();write(false,'lease');}};}catch(error){await lease.release();throw error;}
}
/** A nested supervisor shares the log but has its own scope. The outermost
 * supervisor sees all scopes; a suite's budget sees only that suite's waits.
 * @param {NodeJS.ProcessEnv} [env] @param {string} [scratch] */
export function browserQueueClock(env=process.env,scratch=resolve('tmp',env.WS_LANE_NAME??'browser-task')){
 const owns=env.WS_BROWSER_QUEUE_LOG===undefined,scope=env.WS_BROWSER_QUEUE_SCOPE??randomUUID();
 let path=env.WS_BROWSER_QUEUE_LOG;
 if(path===undefined){mkdirSync(scratch,{recursive:true});path=resolve(scratch,`browser-queue-${randomUUID()}.json`);closeSync(openSync(path,'wx',0o600));}
 const filename=path;
 const read=()=>{
  const fd=ownedFile(filename,constants.O_RDONLY);
  try{const text=readFileSync(fd,'utf8');return text.split('\n').filter(Boolean).map(line=>{const row=JSON.parse(line);if(!event(row))throw new Error('Invalid browser queue event');return row;});}
  finally{closeSync(fd);}
 };
 return{env:{...env,WS_BROWSER_QUEUE_LOG:filename,WS_BROWSER_QUEUE_SCOPE:scope},
  scopes:(/** @type {string[]} */names,/** @type {boolean} */active)=>{const fd=ownedFile(filename,constants.O_WRONLY+constants.O_APPEND);try{for(const name of names)writeSync(fd,`${JSON.stringify({token:name,scope:name,at:Date.now(),waiting:active,kind:'scope'})}\n`);}finally{closeSync(fd);}},
  queued:(/** @type {number} */from,/** @type {number} */now,/** @type {boolean|readonly string[]} */all=false)=>queuedMilliseconds(read(),from,now,Array.isArray(all)?all:all?undefined:scope),
  close:()=>{if(owns)unlinkSync(filename);}};
}
