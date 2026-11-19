#!/usr/bin/env node
// J402 compatibility wrapper. Actual launch adapters own the slots (free cores / 4, DS20c); this
// wrapper adds no second lease and excludes their queue waits from its clock.
import {setTimeout as delay} from 'node:timers/promises';
import * as playwright from './browser-playwright.mjs';
import {installMachineBrowserAdmission} from './browser-machine-loader.mjs';
import {browserStatus} from './browser-usage.mjs';
import {runT1Child} from './t1-runner.mjs';

await installMachineBrowserAdmission(playwright);
const args=process.argv.slice(2),mode=args[0];
if(mode==='status'){const status=browserStatus();console.log(`browser broker: ${status.total} / ${status.slots}; holders ${status.holders.join(', ')}; outside roots ${status.outside.join(', ')}; four cores per reservation`);}
else if(mode==='capacity'){const status=browserStatus();console.log(`${status.slots} ${Math.max(0,status.slots-status.total)}`);}
else if(mode==='free'){const status=browserStatus();process.exitCode=status.total<status.slots?0:1;}
else if(mode==='wait'){
 const began=Date.now();
 for(let status=browserStatus();status.total>=status.slots;status=browserStatus()){if(Date.now()-began>=300000)throw new Error('Browser broker wait exceeded five minutes');await delay(1000);}
}else if(mode==='reap')throw new Error('Run the browser-lane.sh machine reaper');
else{
 let minutes=60;
 if(mode==='--max'){minutes=Number(args[1]);args.splice(0,2);}
 if(args[0]==='--')args.shift();
 if(!Number.isFinite(minutes)||minutes<=0||args.length===0)throw new Error('usage: browser-lane.sh [--max minutes] command...');
 if(args[0]==='agent-browser')throw new Error('Use agent-browser-session.mjs for a complete owned daemon task');
 const result=await runT1Child(args,process.env,{timeoutMs:minutes*60000});
 if(result.error!==null)console.error(result.error);
 process.exitCode=result.error!==null||result.signal!==null?1:result.status??1;
}
