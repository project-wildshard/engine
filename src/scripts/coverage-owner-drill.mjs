#!/usr/bin/env node
// TC26 owning-repository edges; only frozen private exports are mutated.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {linkNodeModules} from './link-node-modules.mjs';

const root=resolve(import.meta.dirname,'..', '..');
const [apiArg,shardArg,outArg='tmp/coverage-owner-drill']=process.argv.slice(2);
assert.ok(apiArg&&shardArg,'usage: coverage-owner-drill.mjs <api-server checkout> <shard-dunes checkout> [tmp/output]');
const api=resolve(apiArg),shard=resolve(shardArg),out=resolve(root,outArg);
assert.ok(out.startsWith(`${root}/tmp/`),'Output must stay in this checkout tmp/');
assert.equal(JSON.parse(readFileSync(join(api,'package.json'),'utf8')).name,'@wildshard/api-server');
assert.equal(JSON.parse(readFileSync(join(shard,'package.json'),'utf8')).name,'@wildshard/shard-dunes');
mkdirSync(out,{recursive:true});writeFileSync(join(out,'receipt.json'),JSON.stringify({complete:false,results:[]}));
const work=mkdtempSync(join(out,'run-'));
/** @type {unknown[]} */const results=[];
/** @param {string} repo @param {string} name */
function archive(repo,name){
  const tree=join(work,name);mkdirSync(tree);
  const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
  execFileSync('tar',['-x','-C',tree],{input:execFileSync('git',['archive',sha],{cwd:repo,maxBuffer:256*1024*1024})});
  return {tree,sha};
}
/** @param {string[]} command @param {string} cwd */
function run(command,cwd){
  const began=performance.now(),child=spawnSync(command[0],command.slice(1),{cwd,encoding:'utf8',timeout:10000,maxBuffer:2*1024*1024,env:{...process.env,TMPDIR:work}});
  assert.equal(child.signal,null,'A signal or timeout is not a detected fault');assert.equal(child.error,undefined,'A process error is not a detected fault');
  return {code:child.status,ms:Math.round(performance.now()-began),text:`${child.stdout??''}\n${child.stderr??''}`};
}
/** @param {string} id @param {string} file @param {(text:string)=>string} mutate
 * @param {string[]} command @param {string} cwd @param {RegExp} reason
 * @param {string} owner @param {string} sha */
function triple(id,file,mutate,command,cwd,reason,owner,sha){
  const before=run(command,cwd);writeFileSync(join(out,`${id}-baseline.log`),before.text);
  assert.equal(before.code,0,`${id}: owning repository's positive control failed`);
  const original=readFileSync(file,'utf8'),planted=mutate(original);assert.notEqual(planted,original);
  let bad;try{writeFileSync(file,planted);bad=run(command,cwd);}finally{writeFileSync(file,original);}
  writeFileSync(join(out,`${id}-planted.log`),bad.text);
  assert.equal(bad.code,1,`${id}: real owner must refuse the plant`);assert.match(bad.text,reason);
  const healed=run(command,cwd);writeFileSync(join(out,`${id}-healed.log`),healed.text);
  assert.equal(healed.code,0,`${id}: restoring source must heal the real owner`);
  results.push({id,owner,sha,fixOwner:id==='export'?'engine:package.json':'api-server:src/server/routes/accounts.ts',baselineMs:before.ms,plantedMs:bad.ms,healedMs:healed.ms});
  writeFileSync(join(out,'receipt.json'),JSON.stringify({complete:results.length===2,results},null,2));
  console.log(`${id}: actual owner green, expected red, healed; ${owner}@${sha}`);
}
try{
  const engine=archive(root,'engine'),consumer=archive(shard,'shard'),account=archive(api,'api');
  linkNodeModules(root,engine.tree);
  mkdirSync(join(consumer.tree,'node_modules/@wildshard'),{recursive:true});
  symlinkSync(engine.tree,join(consumer.tree,'node_modules/@wildshard/engine'));
  mkdirSync(join(consumer.tree,'node_modules/@typescript'),{recursive:true});
  symlinkSync(resolve(root,'node_modules/@typescript/typescript6'),join(consumer.tree,'node_modules/@typescript/typescript6'));
  triple('export',join(engine.tree,'package.json'),text=>{
    const pkg=JSON.parse(text);assert.ok(Object.hasOwn(pkg.exports,'./game/shardfile/outputDescriptor'));
    delete pkg.exports['./game/shardfile/outputDescriptor'];return JSON.stringify(pkg);
  },[process.execPath,'scripts/check-test-boundary.mjs'],consumer.tree,/engine does not export @wildshard\/engine\/game\/shardfile\/outputDescriptor/u,'shard-dunes:Ring3/check-test-boundary',consumer.sha);
  // Bound pnpm to the private API export rather than this engine workspace.
  if(!existsSync(join(account.tree,'pnpm-workspace.yaml')))writeFileSync(join(account.tree,'pnpm-workspace.yaml'),'packages:\n  - .\n');
  execFileSync('git',['init','-q'],{cwd:account.tree});
  execFileSync('pnpm',['install','--frozen-lockfile','--offline'],{cwd:account.tree,stdio:'pipe',timeout:30000});
  triple('auth-route',join(account.tree,'src/server/routes/accounts.ts'),text=>{
    const find='if (account instanceof Response) {\n    return account\n  }';assert.equal(text.split(find).length-1,1);
    return text.replace(find,"if (account instanceof Response) {\n    return jsonResponse(OK, { tc26: 'auth-bypassed' })\n  }");
  },[process.execPath,'--test','--test-reporter=tap','--test-name-pattern=no key, a non-key token or an unknown key is a 401','src/server/routes/accounts-me.test.ts'],account.tree,/AssertionError[\s\S]*401/u,'api-server:push/accounts-me',account.sha);
}finally{rmSync(work,{recursive:true,force:true});}
