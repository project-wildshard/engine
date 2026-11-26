// Build-max C5 (2026-11-21): under heavy load, one push gate at a time per machine. The heavy lane scopes a push lease
// to its checkout, so every worktree and engine-quickfix gated at once; at a load of 25 to 37 each gate ran slower,
// timed-out tests went red, and the gates were rerun. While the 1-minute load average is over GATE_SERIAL_LOAD a gate
// takes the machine's one gate slot (a pid lock: a dead holder's slot is taken over) and holds it to its end. Under that
// load it runs beside the others as before.
import {homedir,loadavg} from 'node:os';
import {mkdirSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {pidLock} from './.kit/pid-lock.mjs';

/** The 1-minute load average over which push gates run one at a time. */
export const GATE_SERIAL_LOAD=24;
/** How often a waiting gate looks again, and how long it waits before running anyway (and saying so). */
export const GATE_SLOT_POLL_MS=15_000;
export const GATE_SLOT_MAX_WAIT_MS=20*60_000;

/** @param {string} file */
function holderOf(file){try{return readFileSync(file,'utf8').trim();}catch{return 'gone';}}

/**
 * Wait for the machine's gate slot while the load is over GATE_SERIAL_LOAD. Returns the release (a no-op when the
 * gate runs without the slot). Each look re-reads the load, so a load that falls lets a waiting gate start.
 * @param {{load?:()=>number,file?:string,lock?:typeof pidLock,sleep?:(ms:number)=>Promise<void>,log?:(line:string)=>void,now?:()=>number}} [options]
 * @returns {Promise<()=>void>}
 */
export async function gateSlot(options={}){
 const {load=()=>loadavg()[0]??0,file=join(homedir(),'.cache/wildshard/push-gate-slot.lock'),lock=pidLock,
  sleep=ms=>new Promise(resolve=>{setTimeout(resolve,ms);}),log=line=>{console.error(line);},now=Date.now}=options;
 const began=now();
 let said=false;
 for(;;){
  const current=load();
  if(current<=GATE_SERIAL_LOAD){
   if(said)log(`  - gate slot: load ${current.toFixed(1)} is back under ${String(GATE_SERIAL_LOAD)}; running beside the holder`);
   return ()=>{ /* Ran without the slot. */ };
  }
  mkdirSync(dirname(file),{recursive:true});
  const release=lock(file,{waitMs:0});
  if(release!==undefined){
   log(`  - gate slot: load ${current.toFixed(1)} is over ${String(GATE_SERIAL_LOAD)}; this gate holds the machine's one slot${said?` after ${String(Math.round((now()-began)/1000))} s`:''}`);
   return release;
  }
  if(now()-began>=GATE_SLOT_MAX_WAIT_MS){
   log(`  - gate slot: waited ${String(Math.round((now()-began)/60_000))} min at load ${current.toFixed(1)}; running beside pid ${holderOf(file)}`);
   return ()=>{ /* Ran without the slot. */ };
  }
  if(!said){log(`  - gate slot: load ${current.toFixed(1)} is over ${String(GATE_SERIAL_LOAD)}; waiting for pid ${holderOf(file)}'s gate (${file})`);said=true;}
  await sleep(GATE_SLOT_POLL_MS);
 }
}
