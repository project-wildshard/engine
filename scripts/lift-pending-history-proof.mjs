// Real Git policy introduction and the actual CLI; outside hooks.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {copyFileSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';

const base=resolvePath(process.argv[2]??'tmp/lift-pending-history');mkdirSync(base,{recursive:true});
const root=mkdtempSync(join(base,'run-')),registeredAt=new Date(Math.floor((Date.now()-3_600_000)/1000)*1000).toISOString();
const inventory='["test/actual.test.ts"]',policy={schema:1,owner:'codex-mock',registeredAt,deadline:new Date(Date.parse(registeredAt)+47*3_600_000).toISOString(),inventorySha256:createHash('sha256').update(inventory).digest('hex'),reason:'Inherited migration debt; no passed execution or renewed exclusion is claimed.'};
const put=()=>writeFileSync(join(root,'test/lift-pending-policy.json'),JSON.stringify(policy));
const run=()=>spawnSync(process.execPath,['scripts/lift-pending.mjs'],{cwd:root,encoding:'utf8'});
try{
 mkdirSync(join(root,'scripts'));mkdirSync(join(root,'test'));copyFileSync('scripts/lift-pending.mjs',join(root,'scripts/lift-pending.mjs'));writeFileSync(join(root,'test/lift-pending.json'),inventory);put();
 for(const args of [['init','--quiet','--initial-branch=main'],['add','test'],['-c','user.name=Lift proof','-c','user.email=proof@example.test','commit','--quiet','-m','first policy']])execFileSync('git',args,{cwd:root,env:{...process.env,GIT_AUTHOR_DATE:registeredAt,GIT_COMMITTER_DATE:registeredAt}});
 assert.equal(run().status,0,run().stderr);
 policy.registeredAt=new Date(Date.parse(registeredAt)+600_000).toISOString();policy.deadline=new Date(Date.parse(policy.registeredAt)+47*3_600_000).toISOString();put();
 assert.notEqual(run().status,0,'Two edited strings cannot renew inherited exclusions');
 policy.registeredAt=registeredAt;policy.deadline=new Date(Date.parse(registeredAt)+48*3_600_000).toISOString();put();
 assert.notEqual(run().status,0,'The original committed deadline is immutable');
 // J200: one recorded extension, capped at 48 h past the original deadline, frozen once committed.
 policy.deadline=new Date(Date.parse(registeredAt)+47*3_600_000).toISOString();
 const extended=new Date(Date.parse(policy.deadline)+48*3_600_000).toISOString();
 const extension={rule:'J200',decidedBy:'Jake',decidedAt:registeredAt,decision:'Proof decision: extend once',deadline:extended,evidence:'proof evidence page',reason:'Proof extension; no passed execution is claimed for the listed files.'};
 Object.assign(policy,{extension:{...extension,deadline:new Date(Date.parse(extended)+1000).toISOString()}});put();
 assert.notEqual(run().status,0,'An extension past the J200 48 h cap is refused');
 Object.assign(policy,{extension:{...extension,decidedBy:'agent'}});put();
 assert.notEqual(run().status,0,'An extension without Jake\'s recorded decision is refused');
 Object.assign(policy,{extension});put();
 assert.notEqual(run().status,0,'An uncommitted extension is refused');
 execFileSync('git',['-c','user.name=Lift proof','-c','user.email=proof@example.test','commit','--quiet','-am','extend once'],{cwd:root});
 const accepted=run();assert.equal(accepted.status,0,accepted.stderr);
 const state=JSON.parse(accepted.stdout);
 assert.equal(state.deadline,extended);assert.equal(state.originalDeadline,policy.deadline);assert.equal(state.extended,true);assert.equal(state.excluded,1);
 Object.assign(policy,{extension:{...extension,deadline:new Date(Date.parse(extended)-1000).toISOString()}});put();
 execFileSync('git',['-c','user.name=Lift proof','-c','user.email=proof@example.test','commit','--quiet','-am','second extension'],{cwd:root});
 assert.notEqual(run().status,0,'A second extension is refused even when committed');
 console.log(JSON.stringify({renewalRefused:true,firstDeadlineImmutable:true,oneJ200ExtensionAccepted:true,secondExtensionRefused:true,capEnforced:true}));
}finally{rmSync(root,{recursive:true,force:true});}
