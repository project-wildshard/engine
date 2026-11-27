#!/usr/bin/env node
// Meta QA 11-26 row 29: an engine push gate sat 44 minutes in `pins install` inside its clean copy, with no limit and no
// word of what it was doing, until the lane killed it. Every step the gate copy runs (its install and its pins) goes
// through this: the command runs in its own process group, and past its limit the whole group is stopped and the step
// fails with its name and its last output. push-checks.mjs's own steps have their watchdog (J505 `stuckLimit`).
//
//   node src/scripts/gate-step.mjs <name> <limit-s> -- <command> [args...]
//
// The CLI passes the command's output through, and exits 124 when the step ran past its limit. `gateStep` runs it
// synchronously (makeGateCopy is synchronous) and throws the named refusal.
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

/** The CLI's exit code for a step stopped at its limit (as timeout(1)). */
export const STUCK_EXIT=124;
/** A step's default limit, in s, unless `WS_GATE_STEP_S` sets one for every step. A normal copy installs in seconds and
 *  a full pins install in one to three minutes on a loaded machine (11-26: load 55 to 78), so these are several times that. */
export const STEP_LIMITS=/** @type {const} */({install:300,'isolated install':300,pins:900});
const GRACE_MS=5000;

/** The step's limit in s: `WS_GATE_STEP_S`, else its default, else 600. @param {string} name @param {NodeJS.ProcessEnv} [env] */
export function stepLimit(name,env=process.env){
 const named=Number(env.WS_GATE_STEP_S);
 if(Number.isFinite(named)&&named>0)return named;
 return /** @type {Record<string,number>} */(STEP_LIMITS)[name]??600;
}

/** The last `count` non-blank lines of `output`, joined with ' | ' ('' when there are none).
 * @param {string} output @param {number} [count] */
export function lastLines(output,count=3){
 return output.split('\n').map(line=>line.trim()).filter(Boolean).slice(-count).join(' | ');
}

/**
 * Run one gate step to its end or its limit. Throws `gate step <name> stuck ...` past the limit, or `gate step <name>
 * exited <code> ...` on a failure; both name the last output. Returns the step's output.
 * @param {string} name @param {string} command @param {readonly string[]} args
 * @param {{cwd:string,env?:NodeJS.ProcessEnv,limitSeconds?:number}} options
 */
export function gateStep(name,command,args,{cwd,env=process.env,limitSeconds=stepLimit(name,env)}){
 const self=fileURLToPath(import.meta.url);
 const child=spawnSync(process.execPath,[self,name,String(limitSeconds),'--',command,...args],{cwd,env,encoding:'utf8',
  stdio:['ignore','pipe','pipe'],maxBuffer:64<<20,timeout:(limitSeconds*1000)+(3*GRACE_MS),killSignal:'SIGKILL'});
 const output=`${child.stdout??''}${child.stderr??''}`,last=lastLines(output)||'(no output)';
 if(child.status===STUCK_EXIT||child.error!==undefined||child.signal!==null)throw new Error(`gate step ${name} stuck: no exit after ${String(limitSeconds)} s, stopped (limit: WS_GATE_STEP_S); last output: ${last}`);
 if(child.status!==0)throw new Error(`gate step ${name} exited ${String(child.status)}: ${last}`);
 return output;
}

/** The CLI: run the command in its own group; past the limit stop the group (TERM, then KILL) and exit STUCK_EXIT. */
function main(){
 const [name='step',limit='600',dashes,command,...args]=process.argv.slice(2);
 if(dashes!=='--'||command===undefined)throw new Error('usage: gate-step.mjs <name> <limit-s> -- <command> [args...]');
 const limitMs=Number(limit)*1000;
 if(!Number.isFinite(limitMs)||limitMs<=0)throw new Error(`gate-step: invalid limit ${limit}`);
 const child=spawn(command,args,{detached:true,stdio:['ignore','inherit','inherit']});
 /** @param {NodeJS.Signals} signal */
 const group=signal=>{try{if(child.pid!==undefined)process.kill(-child.pid,signal);}catch{/* The group is gone. */}};
 let stuck=false;
 const timer=setTimeout(()=>{
  stuck=true;
  process.stderr.write(`gate step ${name}: STUCK, no exit after ${limit} s; stopping it\n`);
  group('SIGTERM');
  setTimeout(()=>{group('SIGKILL');},GRACE_MS).unref();
 },limitMs);
 for(const signal of /** @type {const} */(['SIGINT','SIGTERM']))process.on(signal,()=>{group(signal);process.exit(1);});
 child.once('error',error=>{clearTimeout(timer);process.stderr.write(`gate step ${name}: ${error.message}\n`);process.exit(1);});
 child.once('exit',(code,signal)=>{
  clearTimeout(timer);
  // the step's own children must not outlive it either
  group('SIGKILL');
  process.exit(stuck?STUCK_EXIT:code??(signal===null?1:128));
 });
}

if(process.argv[1]!==undefined&&fileURLToPath(import.meta.url)===process.argv[1])main();
