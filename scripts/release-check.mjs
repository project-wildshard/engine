// Engine release checks use the same complete gate and full receipts as pushes.
import {spawnSync} from 'node:child_process';
import {pushEnvironment} from '../.githooks/push-checks.mjs';
import {PUSH_PROFILE} from './push-budget.mjs';
import {capturePushTree,readPushProof} from './push-proof-cache.mjs';

if(process.argv.slice(2).some(arg=>arg!=='--probe'))throw new Error('Usage: node scripts/release-check.mjs [--probe]');
const probe=process.argv.includes('--probe'),env=pushEnvironment();
// A release requires a full check of HEAD, irrespective of a caller's diff.
Reflect.deleteProperty(env,'WS_PUSH_REFS');Reflect.deleteProperty(env,'WS_PUSH_DESTINATION');
const context=capturePushTree(PUSH_PROFILE,env),proof=context===null?null:readPushProof(context,{mode:'full',files:[]});
if(proof!==null){
 if(probe)console.log(JSON.stringify({run:proof.run,tree:proof.tree,commit:proof.commit,mode:proof.mode}));
 else console.log(`release: skipped pnpm check; exact-tree full proof ${proof.run} at ${proof.commit} (${proof.seconds.toFixed(1)} s, ${proof.finished})`);
}else if(probe){
 console.error('release: no valid exact-tree full proof');process.exitCode=3;
}else{
 console.log('release: no valid full proof; running the normal complete engine gate');
 const result=spawnSync(process.execPath,['.githooks/run-checks.mjs','push','--release-observation'],{env,stdio:'inherit'});
 if(result.error!==undefined)throw result.error;
 process.exitCode=result.status??1;
}
