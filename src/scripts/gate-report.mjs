// J400: preserve the actual local gate's Vitest evidence, including setup failures.
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {scratchDir,refuseTask} from './.kit/scratch-dir.mjs';
import {failingIds} from './push-known-red.mjs';

/** @param {NodeJS.ProcessEnv} env @param {string} [root] @returns {string|undefined} */
export function gateReport(env,root=process.cwd()){
 if(!env.WS_LOCAL_LAND_HEAD)return env.WS_PUSH_TIMINGS;
 const lane=(env.WS_LANE_NAME===''?undefined:env.WS_LANE_NAME)??'local-land';
 if(refuseTask(lane)!==null)throw new Error('Local gate requires a plain lane name');
 const dir=resolve(root,'tmp',lane);
 // Existing lane scratch may belong to an earlier session. Keep its owner and
 // files; this run writes only its own unique report.
 if(!existsSync(dir))scratchDir(lane,'Local gate Vitest reports',{root,env});
 return join(dir,`vitest-${Date.now()}-${process.pid}.json`);
}

/** @param {string} report @param {string} root @param {(line:string)=>void} [say] */
export function printGateReport(report,root,say=line=>console.error(line)){
 say(`  - Vitest report retained: ${report}`);
 const failures=failingIds(report,root);
 if(failures===null){say('  !! Vitest report missing or unreadable; inspect the gate log for interruption or runner failure');return;}
 for(const [file,ids] of failures){
  say(`  X failing file: ${file}`);
  for(const id of ids)say(`     ${id}`);
 }
 if(failures.size===0)say('  - Vitest report names no failing files; inspect unhandled errors and the gate log');
}
