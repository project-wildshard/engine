// J400: the complete ordinary local gate, plus CSS, inside its real lease.
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {dirname,isAbsolute,join,relative,resolve,sep} from 'node:path';
import {assertHeavyLease} from './heavy-lane-lease.mjs';
import {makeGateCopy} from './push-gate-copy.mjs';
import {checkedTreeDirt} from './push-proof-cache.mjs';

assertHeavyLease('full-test');
const root=process.cwd(),expected=process.env.WS_LOCAL_LAND_HEAD??'';
/** @param {string} cwd @param {string[]} args */
const git=(cwd,args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
/** @param {string} cwd */
function verify(cwd){
 if(!/^[a-f0-9]{40}$/u.test(expected)||git(cwd,['rev-parse','HEAD'])!==expected||checkedTreeDirt(cwd).length>0){
  throw new Error('Local land HEAD or checked tree changed; nothing may be pushed');
 }
}
verify(root);
const common=realpathSync(resolve(root,git(root,['rev-parse','--git-common-dir'])));
const key=createHash('sha256').update(common).digest('hex').slice(0,20);
const scheduler=process.env.WS_HEAVY_SCHEDULER_ROOT??join(homedir(),'.wildshard-heavy-lanes');
const plannedDirectory=resolve(scheduler,'local-land-checkouts',key);
mkdirSync(plannedDirectory,{recursive:true,mode:0o700});
const directory=realpathSync(plannedDirectory);
const fromSource=relative(dirname(common),directory);
if(!isAbsolute(fromSource)&&fromSource!=='..'&&!fromSource.startsWith(`..${sep}`)){
 throw new Error('The isolated local land checkout must be outside the publishing repository');
}
const source=spawnSync('git',['symbolic-ref','--quiet','HEAD'],{cwd:root,encoding:'utf8'});
const env={...process.env,XDG_CACHE_HOME:join(directory,'tools'),npm_config_enable_global_virtual_store:'false',
 npm_config_package_import_method:'clone-or-copy',WS_LOCAL_LAND_SOURCE_REF:source.stdout?.trim()??''};
Reflect.deleteProperty(env,'WS_PUSH_REFS');
const copy=makeGateCopy(root,expected,{env,directory,installIsolated:true});
try{
 verify(copy.path);
 // npr's default machine cache can itself be a global pnpm install. Seal the
 // repo's tool lock in a separate cache before the proof reads its bytes.
 if(existsSync(join(copy.path,'.bin-deps','package.json'))){
  const warm=spawnSync('pnpm',['exec','npr','which','tsc'],{
   cwd:copy.path,env:{...env,npm_config_offline:'true'},encoding:'utf8',stdio:['ignore','pipe','pipe'],
  });
  if(warm.status!==0)throw new Error(`Local land could not install its pinned compiler tools: ${warm.error?.message??warm.stderr.trim()}`);
 }
 const css=spawnSync(process.execPath,['scripts/check-css.mjs'],{cwd:copy.path,env,stdio:'inherit'});
 if(css.status!==0)process.exitCode=css.status??1;
 else{
  const full=spawnSync(process.execPath,['.githooks/push-checks.mjs'],{cwd:copy.path,env,stdio:'inherit'});
  process.exitCode=full.status??1;
 }
 if(process.exitCode===0){verify(copy.path);verify(root);}
}finally{copy.remove();}
