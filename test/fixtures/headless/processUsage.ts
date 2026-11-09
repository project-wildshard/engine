// oxlint-disable-next-line import/no-nodejs-modules -- Write only a short diagnostic to the native child's existing stdout.
import {writeSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- A process-wide CPU sample belongs to the recorder, not each worker thread.
import {isMainThread} from 'node:worker_threads';

const recorders=new Set(['nalati-awareness-run.ts','nalati-discovery-run.ts']);
let registered=false;

/** Observe complete real recorder processes without changing their verdict or simulation. */
export function recordNativeProcessUsage():void {
  const entry=process.argv[1]?.replaceAll('\\','/').split('/').at(-1);
  if(!isMainThread||registered||!recorders.has(entry??''))return;
  registered=true;
  process.once('exit',exitCode=>{
    try{
      const cpu=process.cpuUsage(),resources=process.resourceUsage();
      writeSync(process.stdout.fd,JSON.stringify({diagnostic:'native-process-usage',entry,exitCode,
        wallMs:process.uptime()*1000,userCpuMs:cpu.user/1000,systemCpuMs:cpu.system/1000,maxRssKiB:resources.maxRSS})+'\n');
    }catch{
      // A missing optional sample is no evidence; reporting cannot mask the original test verdict.
    }
  });
}
