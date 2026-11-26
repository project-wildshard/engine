#!/usr/bin/env node
// Reads operator JSONL, or the authenticated bounded API export. No VPS access.
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve as resolvePath} from 'node:path';
import {parseArgs} from 'node:util';

/** @param {unknown} value @returns {value is Record<string,unknown>} */
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
/** @param {unknown} value */
const measured=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
/** @param {readonly Record<string,unknown>[]} rows */
export function sittingTable(rows){
 /** @type {Map<string,{build:string,session:string,seconds:number,frames:number,rtts:number[],p95s:number[],corrections:Record<string,number>,maxOffset:number,reconnects:number,reconnectMs:number}>} */const sessions=new Map();
 /** @type {Record<string,unknown>[]} */const rooms=[];let hits=0,clamped=0,fileCorrections=0,dropped=0,closed=false;
 for(const row of rows){
  if(row.kind==='net'){
   const metrics=record(row.metrics)?row.metrics:row,key=`${String(row.build)}/${String(row.session)}`;
   const session=sessions.get(key)??{build:String(row.build),session:String(row.session),seconds:0,frames:0,rtts:[],p95s:[],corrections:{foot:0,board:0,swim:0,ride:0},maxOffset:0,reconnects:0,reconnectMs:0};
   const seconds=measured(metrics.seconds),frames=measured(metrics.frames);if(seconds===null||seconds<=0||frames===null)throw new Error('Net record lacks measured session time/frames');
   session.seconds+=seconds;session.frames+=frames;
   const rtt=measured(metrics.rttMs),p95=measured(metrics.rttP95);if(rtt!==null)session.rtts.push(rtt);if(p95!==null)session.p95s.push(p95);
   if(!record(row.corrections))throw new Error('Net record lacks correction modes');
   for(const mode of ['foot','board','swim','ride']){const count=measured(row.corrections[mode]);if(count===null)throw new Error('Missing measured correction count');session.corrections[mode]=(session.corrections[mode]??0)+count;}
   const offset=measured(metrics.maxOffset),reconnects=measured(metrics.reconnects),reconnectMs=measured(metrics.reconnectMs);
   if(offset===null||reconnects===null||reconnectMs===null)throw new Error('Missing measured correction/reconnect values');
   session.maxOffset=Math.max(session.maxOffset,offset);session.reconnects+=reconnects;session.reconnectMs+=reconnectMs;sessions.set(key,session);
  }else if(row.kind==='room'||row.at==='worker')rooms.push(record(row.metrics)?row.metrics:row);
  else if(row.kind==='hit'&&row.network===true&&record(row.rewind)){hits++;if(row.rewind.clamped===true)clamped++;}
  else if(row.kind==='correction')fileCorrections++;
  else if(row.at==='playtest.closed'||row.at==='playtest.failed'){closed||=row.at==='playtest.closed';dropped=Math.max(dropped,measured(row.dropped)??0);}
 }
 /** @param {number[]} values */
 const median=values=>{const sorted=[...values].sort((a,b)=>a-b);return sorted.length===0?null:sorted[Math.floor(sorted.length/2)]??null;};
 const clients=[...sessions.values()].map(row=>({build:row.build,session:row.session,seconds:row.seconds,frames:row.frames,corrections:row.corrections,maxOffset:row.maxOffset,reconnects:row.reconnects,reconnectMs:row.reconnectMs,rttMs:median(row.rtts),worstWindowRttP95:row.p95s.length===0?null:Math.max(...row.p95s),fps:row.frames/row.seconds,correctionsPerMinute:Object.fromEntries(Object.entries(row.corrections).map(([mode,count])=>[mode,count*60/row.seconds]))}));
 /** @param {string} field */
 const numbers=(field)=>rooms.flatMap(row=>{const value=measured(row[field]);return value===null?[]:[value];});
 const rates=numbers('ticksPerSecond'),p95s=numbers('p95');
 return {clients,server:{readings:rooms.length,minTicksPerSecond:rates.length===0?null:Math.min(...rates),worstWorkerP95:p95s.length===0?null:Math.max(...p95s)},rewind:{settledNetworkHits:hits,clamped,clampedPercent:hits===0?null:clamped*100/hits,reviewJ127:hits>0&&clamped/hits>.25},playtest:{fileCorrections,dropped,complete:closed?dropped===0:null}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolvePath(process.argv[1])).href){
 const {values,positionals:files}=parseArgs({allowPositionals:true,options:{json:{type:'boolean'},api:{type:'string'},day:{type:'string'},tag:{type:'string'}}});
 if(files.length===0&&values.api===undefined)throw new Error('Usage: e7-playtest-table.mjs [--api origin --day YYYY-MM-DD --tag sitting] [--json] exported.jsonl playtest-date.jsonl');
 const rows=files.flatMap(file=>readFileSync(file,'utf8').split('\n').filter(line=>line.trim()!=='').map((line,index)=>{try{const value=JSON.parse(line);if(!record(value))throw new Error('record');return value;}catch{throw new Error(`Invalid JSON record: ${file}:${index+1}`);}}));
 if(values.api!==undefined){
  const password=process.env.WS_TELEMETRY_REVIEW_PASSWORD;if(!password)throw new Error('Set WS_TELEMETRY_REVIEW_PASSWORD for the authenticated export');
  if(values.day===undefined||!/^\d{4}-\d{2}-\d{2}$/u.test(values.day))throw new Error('A valid --day is required for a Blob export');
  const url=new URL('/api/telemetry',values.api);
  if(url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw new Error('The authenticated export requires HTTPS or loopback');
  url.searchParams.set('records','e7');url.searchParams.set('day',values.day);if(values.tag!==undefined)url.searchParams.set('tag',values.tag);
  const response=await fetch(url,{headers:{'x-review-password':password},redirect:'error',signal:AbortSignal.timeout(15_000)});
  if(!response.ok)throw new Error(`E7 telemetry export refused HTTP${response.status}`);
  const value=await response.json();if(!record(value)||!Array.isArray(value.records)||!value.records.every(record))throw new Error('Invalid E7 telemetry export');
  rows.push(...value.records);
 }
 const table=sittingTable(rows);
 if(values.json)console.log(JSON.stringify(table));
 else{
  /** @param {unknown} value */
  const show=value=>typeof value==='number'?value.toFixed(2):'unknown';
  console.log('| Build / anonymous session | Median window RTT ms | Worst window RTT p95 ms | Corrections/min foot,board,swim,ride | Biggest offset m | Frames/s | Reconnects / total ms |\n|---|---:|---:|---|---:|---:|---|');
  for(const row of table.clients)console.log(`| ${row.build} / ${row.session} | ${show(row.rttMs)} | ${show(row.worstWindowRttP95)} | ${Object.values(row.correctionsPerMinute).map(show).join(', ')} | ${show(row.maxOffset)} | ${show(row.fps)} | ${row.reconnects} / ${show(row.reconnectMs)} |`);
  console.log(`Server: minimum ${show(table.server.minTicksPerSecond)} ticks/s; worst observed worker-window p95 ${show(table.server.worstWorkerP95)} ms. Rewind: ${table.rewind.clamped}/${table.rewind.settledNetworkHits} settled network hits clamped (${show(table.rewind.clampedPercent)}%). File corrections ${table.playtest.fileCorrections}; dropped ${table.playtest.dropped}.`);
  if(table.rewind.reviewJ127)console.log('J127 REVIEW: clamped hits exceed25%; record a second sitting proposal for Jake. The12-tick cap is unchanged.');
 }
}
