import {afterEach,expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Native Git history and real proof receipts.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Owned fixture contents and cleanup.
import {chmodSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths stay in this lane's scratch.
import {join,resolve} from 'node:path';
import {capturePushTree,readPushProof,writePushProof} from '../scripts/push-proof-cache.mjs';
import {installProofFixture} from '../scripts/proof-fixture-install.mjs';
import * as deltaPlanner from '../scripts/local-land-delta.mjs';
const {localDeltaPlan}=deltaPlanner;

const roots=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(mode='full'){
 const parent=resolve(process.env.VITEST_TMP_ROOT??'tmp/codex-pagesize','local-delta');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'case-'));roots.push(root);
 const env={...Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))),GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
 // Model a local publisher inside the fixture; the actual test runner may be hosted CI.
 const proofEnv={...env,CI:'',GITHUB_ACTIONS:'',WS_PUSH_REFS:''};
 const git=(...args)=>execFileSync('git',args,{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const put=(file,text)=>{mkdirSync(join(root,file,'..'),{recursive:true});writeFileSync(join(root,file),text);};
 const commit=(file,text)=>{put(file,text);git('add','--',file);git('-c','user.name=Fixture','-c','user.email=fixture@example.test','commit','--quiet','-m','fixture');return git('rev-parse','HEAD');};
 git('init','--quiet','-b','main');installProofFixture(root);commit('.gitignore','tmp/\n');commit('src/a.ts','export const a=1;');
 const baseMain=commit('src/b.ts','export const b=1;');
 const testedHead=commit('src/a.ts','export const a=2;');
 const context=capturePushTree('delta-fixture',proofEnv,root);if(context===null)throw new Error('Missing clean fixture proof context');
 if(mode!=='missing')writePushProof(context,{mode,files:['src/a.ts']},1);
 git('switch','--quiet','--detach',baseMain);
 const incomingMain=commit('src/b.ts','export const b=2;');
 git('-c','user.name=Fixture','-c','user.email=fixture@example.test','cherry-pick',testedHead);
 const head=git('rev-parse','HEAD');
 const current=()=>{const value=capturePushTree('delta-fixture',proofEnv,root);if(value===null)throw new Error('Missing current proof context');return value;};
 return {root,git,put,commit,current,proofEnv,original:context,basis:{baseMain,testedHead,incomingMain,head}};
}

test('FL5b authenticates a prior full proof and selects only incoming-main paths',()=>{
 const f=fixture();const plan=localDeltaPlan(f.current(),f.basis);
 expect(plan.eligible).toBe(true);expect(plan.selection.files).toEqual(['src/b.ts']);
 expect(plan.proof.mode).toBe('full');
});
test('FL9 discovers a real full proof after a separate branch rebase',()=>{
 const f=fixture();
 f.git('switch','--quiet','-c','plan/reuse',f.basis.testedHead);
 f.git('-c','user.name=Fixture','-c','user.email=fixture@example.test','rebase','--quiet',f.basis.incomingMain);
 const plan=deltaPlanner.discoverLocalDeltaPlan(f.current(),f.basis.incomingMain);
 expect(plan.eligible).toBe(true);expect(plan.selection.files).toEqual(['src/b.ts']);
 expect(plan.proof.commit).toBe(f.basis.testedHead);
});
test.each(['missing','related','altered','runtime','composed'])('FL9 discovery refuses %s evidence',mode=>{
 const f=fixture(mode==='missing'||mode==='related'?mode:'full');
 if(mode==='composed')writePushProof(f.original,{mode:'full',files:[]},1,{run:'earlier',commit:f.basis.baseMain});
 f.git('switch','--quiet','-c','plan/reuse',f.basis.testedHead);
 f.git('-c','user.name=Fixture','-c','user.email=fixture@example.test','rebase','--quiet',f.basis.incomingMain);
 if(mode==='altered')f.commit('src/a.ts','export const a=3;');
 const context=f.current();
 expect(deltaPlanner.discoverLocalDeltaPlan(mode==='runtime'?{...context,runtime:'f'.repeat(64)}:context,f.basis.incomingMain).eligible).toBe(false);
});
test.each(['missing','related'])('FL5b %s proof cannot carry a full gate',mode=>{
 const f=fixture(mode);expect(localDeltaPlan(f.current(),f.basis).eligible).toBe(false);
});
test.each(['CI','GITHUB_ACTIONS'])('FL5b %s still refuses local cache proofs',key=>{
 const f=fixture('missing');
 const env={...f.proofEnv,[key]:'true'};
 expect(capturePushTree('delta-fixture',env,f.root)).toBeNull();
 const refs=`refs/heads/main ${f.basis.head} refs/heads/main ${f.basis.incomingMain}`;
 expect(capturePushTree('delta-fixture',{...env,WS_PUSH_REFS:refs},f.root)).toBeNull();
});
test('FL5b runtime changes and unavailable proof context keep the complete gate',()=>{
 const f=fixture();
 expect(localDeltaPlan({...f.current(),runtime:'f'.repeat(64)},f.basis).eligible).toBe(false);
 expect(localDeltaPlan(null,f.basis).eligible).toBe(false);
});
test('FL5b composed coverage retains the authenticated full-proof lineage',()=>{
 const f=fixture(),context=f.current(),plan=localDeltaPlan(context,f.basis);
 if(plan.proof===null)throw new Error('Expected verified full parent');
 writePushProof(context,{mode:'full',files:[]},.5,{run:plan.proof.run,commit:plan.proof.commit});
 const composed=readPushProof(f.current(),{mode:'full',files:[]});
 expect(composed?.inherited).toEqual({run:plan.proof.run,commit:plan.proof.commit});
});
test('FL5b a composed proof cannot seed another reduced gate',()=>{
 const f=fixture();
 writePushProof(f.original,{mode:'full',files:[]},1,{run:'earlier-run',commit:f.basis.baseMain});
 expect(localDeltaPlan(f.current(),f.basis).eligible).toBe(false);
});
test('FL5b repeated races compare cumulative main changes with the original full proof',()=>{
 const f=fixture();
 f.git('switch','--quiet','--detach',f.basis.incomingMain);
 const incomingMain=f.commit('src/c.ts','export const c=2;');
 f.git('-c','user.name=Fixture','-c','user.email=fixture@example.test','cherry-pick',f.basis.head);
 const plan=localDeltaPlan(f.current(),{...f.basis,incomingMain,head:f.git('rev-parse','HEAD')});
 expect(plan.eligible).toBe(true);
 expect(plan.selection?.files).toEqual(['src/b.ts','src/c.ts']);
 expect(plan.proof?.commit).toBe(f.basis.testedHead);
});
test('FL5b writable or malformed prior receipts keep the full gate',()=>{
 const f=fixture();chmodSync(f.original.file,0o666);
 expect(localDeltaPlan(f.current(),f.basis).eligible).toBe(false);
 chmodSync(f.original.file,0o600);writeFileSync(f.original.file,'{broken');
 expect(localDeltaPlan(f.current(),f.basis).eligible).toBe(false);
});
test.each(['package.json','pnpm-lock.yaml','vitest.config.ts','test/pins/fixture.json'])('FL5b %s delta never narrows the harness to related tests',file=>{
 const f=fixture();f.git('switch','--quiet','--detach',f.basis.incomingMain);
 const incomingMain=f.commit(file,file.endsWith('.json')?'{}':'# fixture');
 f.git('-c','user.name=Fixture','-c','user.email=fixture@example.test','cherry-pick',f.basis.head);
 const plan=localDeltaPlan(f.current(),{...f.basis,incomingMain,head:f.git('rev-parse','HEAD')});
 expect(plan.eligible?plan.selection?.mode:'full').toBe('full');
});
test('FL5b overlap, altered feature, wrong HEAD and malformed basis keep the full gate',()=>{
 const f=fixture();
 expect(localDeltaPlan(f.current(),{...f.basis,baseMain:f.git('rev-parse',`${f.basis.baseMain}^`)}).eligible).toBe(false);
 const changed=f.commit('src/a.ts','export const a=3;');
 expect(localDeltaPlan(f.current(),{...f.basis,head:changed}).eligible).toBe(false);
 expect(localDeltaPlan(f.current(),f.basis).eligible).toBe(false);
 expect(localDeltaPlan(f.current(),{head:'forged'}).eligible).toBe(false);
});
