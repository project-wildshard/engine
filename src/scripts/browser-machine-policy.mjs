// J402 machine policy: every physical launch spends one of the CPU ledger's
// four-core browser slots, free cores / 4 (DS20c, FS17). Author tools discover this provider locally.
import process from 'node:process';
import {setTimeout as delay} from 'node:timers/promises';
import {browserStatus} from './browser-usage.mjs';
import {holdCpu} from './cpu-admission.mjs';
import {installBrowserAdmission} from './browser-launch-admission.mjs';
import {createBrowserAdmissions} from './browser-file-admission.mjs';
import {browserQueue} from './browser-queue-clock.mjs';

/** @type {NodeJS.Process&{__wildshardBrowserAdmissions?:ReturnType<typeof createBrowserAdmissions>}} */
const owner=process;
const admissions=owner.__wildshardBrowserAdmissions??=createBrowserAdmissions(()=>browserQueue(async()=>{
 const deadline=Date.now()+300000;
 let status=browserStatus();
 while(status.total>=status.slots){
  if(Date.now()>=deadline)throw new Error(`Browser admission exceeded five minutes; holders: ${[...status.holders,...status.outside].join(', ')}`);
  await delay(1000);status=browserStatus();
 }
 return holdCpu(4,{browser:true,repo:process.cwd()});
}));

/** @param {unknown} error @param {{lost:boolean}} [context] */
function stopOwner(error,context){
 console.error(context?.lost?'Browser admission lost; stopping owner:':'Browser drain refused; retaining owner and admission:',error);
 process.exitCode=1;
 if(context?.lost)process.kill(process.pid,'SIGTERM');
}

/** @param {{chromium:object,firefox:object,webkit:object}} playwright */
export function install(playwright){
 for(const type of [playwright.chromium,playwright.firefox,playwright.webkit]){
  installBrowserAdmission(type,admissions.forLaunch,stopOwner);
 }
}

/** Wait before a test worker's collection/case clock; one physical browser at a time. */
export function reserve(){return admissions.holdForFile();}
