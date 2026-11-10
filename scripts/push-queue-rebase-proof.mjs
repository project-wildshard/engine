// Real divergent Git histories, official source hashes and a dirty source checkout.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {delimiter,dirname,join,resolve as resolvePath} from 'node:path';
import {pathToFileURL} from 'node:url';

const engine=resolvePath(process.argv.find(arg=>arg.startsWith('--engine='))?.slice(9)??'.');
const directory=resolvePath(process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)??'tmp/push-queue-rebase-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),began=performance.now(),sourceConflict=process.argv.includes('--source-conflict');
const race=process.argv.includes('--race');
const singleStamp=process.argv.includes('--single-stamp');
const deletedInput=process.argv.includes('--deleted-input');
const validationConflict=process.argv.includes('--validation-conflict');
/** @param {string} cwd @param {string[]} args */
const git=(cwd,args)=>execFileSync('git',['-c','user.name=Rebase proof','-c','user.email=proof@example.test',...args],{cwd,encoding:'utf8'}).trim();
try{
 const seed=join(work,'seed'),remote=join(work,'remote.git'),source=join(work,'source'),upstream=join(work,'upstream'),queue=join(work,'queue');mkdirSync(seed);
 git(seed,['init','--quiet','--initial-branch=main']);git(seed,['init','--quiet','--bare','--initial-branch=main',remote]);git(seed,['remote','add','origin',remote]);mkdirSync(join(seed,'scripts'));mkdirSync(join(seed,'.githooks'));
 const renderer=pathToFileURL(resolvePath('scripts/renderer-revision.mjs')).href,validation=pathToFileURL(resolvePath('scripts/shardfile-validation-revision.mjs')).href;
 for(const [name,url,fn] of [['renderer',renderer,'rendererRevision'],['validation',validation,'shardfileValidationRevision']])writeFileSync(join(seed,`scripts/stamp-${name}-revision.mjs`),`import{writeFileSync}from'node:fs';import{${fn}}from${JSON.stringify(url)};writeFileSync('scripts/${name}-revision.json',JSON.stringify({revision:${fn}(process.cwd())})+'\\n');`);
 writeFileSync(join(seed,'gate.mjs'),`import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{rendererRevision}from${JSON.stringify(renderer)};import{shardfileValidationRevision}from${JSON.stringify(validation)};for(const[name,fn]of [['renderer',rendererRevision],['validation',shardfileValidationRevision]])assert.equal(JSON.parse(readFileSync('scripts/'+name+'-revision.json')).revision,fn(process.cwd()));assert.equal(readFileSync('lane.txt','utf8'),'lane');assert.equal(readFileSync('upstream.txt','utf8'),'upstream');`);
 writeFileSync(join(seed,'.githooks/pre-push'),'#!/usr/bin/env bash\nset -euo pipefail\nnode gate.mjs\n');chmodSync(join(seed,'.githooks/pre-push'),0o755);
 writeFileSync(join(seed,'package.json'),JSON.stringify({name:'queue-rebase-proof',private:true,version:'1.0.0',type:'module'}));writeFileSync(join(seed,'pnpm-workspace.yaml'),'packages: []\n');writeFileSync(join(seed,'.gitignore'),'node_modules/\n');
 for(const name of ['lane.txt','upstream.txt','shared.txt'])writeFileSync(join(seed,name),'base');
 mkdirSync(join(seed,'src/client/engine/boot'),{recursive:true});writeFileSync(join(seed,'src/client/engine/boot/fixture.ts'),'export const value=0;');writeFileSync(join(seed,'src/client/engine/boot/upstream.ts'),'export const upstream=0;');
 execFileSync('pnpm',['install','--lockfile-only'],{cwd:seed,stdio:'pipe'});
 git(seed,['add','scripts/stamp-renderer-revision.mjs','scripts/stamp-validation-revision.mjs','gate.mjs','.githooks/pre-push','package.json','pnpm-workspace.yaml','pnpm-lock.yaml','.gitignore','lane.txt','upstream.txt','shared.txt','src/client/engine/boot/fixture.ts','src/client/engine/boot/upstream.ts']);git(seed,['commit','--quiet','-m','seed']);
 /** @param {string} cwd */
 const stamp=cwd=>{for(const name of ['renderer','validation'])execFileSync(process.execPath,[`scripts/stamp-${name}-revision.mjs`],{cwd});};
 stamp(seed);git(seed,['add','scripts/renderer-revision.json','scripts/validation-revision.json']);git(seed,['commit','--quiet','-m','initial official stamps']);git(seed,['push','--quiet','origin','main']);
 for(const clone of [source,upstream])execFileSync('git',['clone','--quiet',remote,clone]);
 writeFileSync(join(source,'lane.txt'),'lane');writeFileSync(join(source,'scripts/lane-input.mjs'),'export const lane=1;');if(singleStamp||validationConflict)writeFileSync(join(source,'src/client/engine/boot/fixture.ts'),'export const value=1;');if(deletedInput)unlinkSync(join(source,'src/client/engine/boot/fixture.ts'));git(source,['add','scripts/lane-input.mjs']);git(source,['commit','--quiet','-m','lane source','--','lane.txt','scripts/lane-input.mjs','src/client/engine/boot/fixture.ts']);stamp(source);git(source,['commit','--quiet',...(deletedInput?['--amend','--no-edit']:['-m','lane stamps']),'--','scripts/renderer-revision.json',...(singleStamp?[]:['scripts/validation-revision.json'])]);
 writeFileSync(join(upstream,sourceConflict?'lane.txt':'upstream.txt'),'upstream');writeFileSync(join(upstream,'scripts/upstream-input.mjs'),'export const upstream=1;');if(validationConflict)writeFileSync(join(upstream,'src/client/engine/boot/upstream.ts'),'export const upstream=1;');git(upstream,['add','scripts/upstream-input.mjs']);git(upstream,['commit','--quiet','-m','upstream source','--',sourceConflict?'lane.txt':'upstream.txt','scripts/upstream-input.mjs','src/client/engine/boot/upstream.ts']);stamp(upstream);git(upstream,['commit','--quiet','-m','upstream stamps','--','scripts/renderer-revision.json','scripts/validation-revision.json']);git(upstream,['push','--quiet','origin','main']);const before=git(upstream,['rev-parse','HEAD']);
 writeFileSync(join(source,'shared.txt'),'peer dirty bytes preserved');
 /** @type {NodeJS.ProcessEnv} */const env={...process.env,WS_LANE_RECEIPTS:join(work,'receipts.log')};
 const raced=join(work,'raced');
 if(race){
  const bin=join(work,'git-bin'),count=join(work,'fetch-count'),actualGit=execFileSync('which',['git'],{encoding:'utf8'}).trim();mkdirSync(bin);
  const wrapper=join(bin,'git');
  writeFileSync(wrapper,`#!${process.execPath}\nimport{spawnSync,execFileSync}from'node:child_process';import{existsSync,readFileSync,writeFileSync}from'node:fs';const args=process.argv.slice(2),result=spawnSync(${JSON.stringify(actualGit)},args,{stdio:'inherit'});if(result.status===0&&args.join(' ')==='fetch origin main'&&process.cwd().includes('/snapshots/')){const count=${JSON.stringify(count)},n=existsSync(count)?Number(readFileSync(count,'utf8'))+1:1;writeFileSync(count,String(n));if(n===2){writeFileSync(${JSON.stringify(join(upstream,'race.txt'))},'actual remote race');for(const a of [['add','race.txt'],['-c','user.name=Race proof','-c','user.email=proof@example.test','commit','--quiet','-m','remote race'],['push','--quiet','origin','main']])execFileSync(${JSON.stringify(actualGit)},a,{cwd:${JSON.stringify(upstream)},stdio:'inherit'});writeFileSync(${JSON.stringify(raced)},'real Git fetch completed before upstream advanced');}}process.exitCode=result.status??1;`);chmodSync(wrapper,0o755);env['PATH']=[bin,env['PATH']??''].join(delimiter);
 }
 const job=JSON.parse(execFileSync(process.execPath,[join(engine,'scripts/push-queue.mjs'),'enqueue',source,`--root=${queue}`],{env,encoding:'utf8'}));let result;
 const started=Date.now();while(Date.now()-started<8000){result=JSON.parse(readFileSync(join(dirname(dirname(job.snapshot)),`${job.id}.json`),'utf8'));if(['pushed','failed'].includes(result.state)&&!existsSync(job.snapshot))break;await new Promise(resolve=>{setTimeout(resolve,10);});}
 assert.equal(readFileSync(join(source,'shared.txt'),'utf8'),'peer dirty bytes preserved');
 assert.equal(git(source,['rev-parse','HEAD']),job.sha,'The queue must never rebase its source checkout');
 if(sourceConflict){assert.equal(result?.state,'failed');assert.match(result.error,/Queue snapshot rebase conflict: lane\.txt/u);assert.equal(git(upstream,['--git-dir',remote,'rev-parse','main']),before);}
 else{assert.equal(result?.state,'pushed',result?.error);assert.equal(git(upstream,['--git-dir',remote,'show','main:lane.txt']),'lane');assert.equal(git(upstream,['--git-dir',remote,'show','main:upstream.txt']),'upstream');}
 if(race){assert.ok(existsSync(raced),'Actual remote must advance after the first helper fetch');assert.equal(git(upstream,['--git-dir',remote,'show','main:race.txt']),'actual remote race');assert.equal(result.attempts,1,'Race must resolve before spending a publication gate');}
 assert.ok(!existsSync(job.snapshot));console.log(JSON.stringify({sourceConflict,race,dirtySourcePreserved:true,officialCombinedStamps:!sourceConflict,namedSourceRefusal:sourceConflict,seconds:(performance.now()-began)/1000}));
}finally{rmSync(work,{recursive:true,force:true});}
