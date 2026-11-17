#!/usr/bin/env node
// J402 compatibility wrapper. Actual launch adapters own the two slots; this
// wrapper adds no second lease and excludes their queue waits from its clock.
import {setTimeout as delay} from 'node:timers/promises';
import * as playwright from './browser-playwright.mjs';
import {installMachineBrowserAdmission} from './browser-machine-loader.mjs';
import {browserUsage as owners,browserStatus} from './browser-usage.mjs';
import {runT1Child} from './t1-runner.mjs';

await installMachineBrowserAdmission(playwright);
const args=process.argv.slice(2),mode=args[0];
if(mode==='status'){const status=browserStatus();console.log(`browser broker: ${status.total} / 2; holders ${status.holders.join(', ')}; outside roots ${status.outside.join(', ')}; four cores per reservation`);}
else if(mode==='capacity')console.log(`2 ${Math.max(0,2-owners())}`);
else if(mode==='free')process.exitCode=owners()<2?0:1;
else if(mode==='wait'){
 const began=Date.now();
 while(owners()>=2){if(Date.now()-began>=300000)throw new Error('Browser broker wait exceeded five minutes');await delay(1000);}
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
