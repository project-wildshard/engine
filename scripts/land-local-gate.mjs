// J400: the complete ordinary local gate, plus CSS, inside its real lease.
import {spawnSync} from 'node:child_process';
import {assertHeavyLease} from './heavy-lane-lease.mjs';
import {checkedTreeDirt} from './push-proof-cache.mjs';

assertHeavyLease('full-test');
function verify(){
 const expected=process.env.WS_LOCAL_LAND_HEAD;
 const head=spawnSync('git',['rev-parse','HEAD'],{encoding:'utf8'});
 if(!/^[a-f0-9]{40}$/u.test(expected??'')||head.status!==0||head.stdout.trim()!==expected
   ||checkedTreeDirt(process.cwd()).length>0)throw new Error('Local land HEAD or checked tree changed; nothing may be pushed');
}
verify();
const css=spawnSync(process.execPath,['scripts/check-css.mjs'],{stdio:'inherit'});
if(css.status!==0)process.exitCode=css.status??1;
else{
 const env={...process.env};Reflect.deleteProperty(env,'WS_PUSH_REFS');
 const full=spawnSync(process.execPath,['.githooks/push-checks.mjs'],{env,stdio:'inherit'});
 process.exitCode=full.status??1;
}
if(process.exitCode===0)verify();
