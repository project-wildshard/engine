// TS22b: a reused worker must not inherit its own expired file context.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve as resolvePath} from 'node:path';

const root=resolvePath(process.argv[2]??'tmp/shared-cpu-proof',`run-${process.pid}`);mkdirSync(root,{recursive:true});
const repo=process.cwd(),setup=resolvePath(process.argv[3]??'src/scripts/vitest-cpu.ts');
const mode=process.argv[4]??'all';assert.ok(['all','ordinary','forged'].includes(mode));
const bootstrap=join(root,'bootstrap.mjs'),files=['a','b','c'].map(name=>join(root,`${name}.test.mjs`));
writeFileSync(bootstrap,`if(globalThis.__priorFileCpuContext!==undefined)process.env.WS_CPU_PARENT_GRANT=process.env.CPU_REUSE_FORGED==='1'?'UNTRUSTED_CONTEXT_NOT_ECHOED':globalThis.__priorFileCpuContext;`);
for(const file of files)writeFileSync(file,`import {test,expect} from 'vitest';import {readFileSync,writeFileSync} from 'node:fs';test('fresh owned file grant',()=>{expect(process.env.WS_CPU_PARENT_GRANT).toBeTruthy();const state=JSON.parse(readFileSync(${JSON.stringify(join(root,'cpu/queue.json'))},'utf8'));expect(state.cpuActive.length).toBe(1);expect(state.cpuQueue.length).toBe(0);globalThis.__priorFileCpuContext=process.env.WS_CPU_PARENT_GRANT;writeFileSync(${JSON.stringify(`${file}.ran`)},'yes');});`);
const config=join(root,'config.ts');
writeFileSync(config,`import {defineConfig} from 'vitest/config';import {BaseSequencer} from 'vitest/node';import base from ${JSON.stringify(join(repo,'vitest.config.ts'))};const {projects,...test}=base.test??{};class Ordered extends BaseSequencer{sort(files){return Promise.resolve([...files].sort((a,b)=>a.moduleId.localeCompare(b.moduleId)));}}export default defineConfig({...base,test:{...test,include:${JSON.stringify(files)},setupFiles:[${JSON.stringify(bootstrap)},${JSON.stringify(setup)},${JSON.stringify(join(repo,'test/setup.ts'))}],isolate:false,maxWorkers:1,fileParallelism:false,sequence:{sequencer:Ordered}}});`);
/** @type {NodeJS.ProcessEnv} */
const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('WS_CPU_')&&!key.startsWith('WS_HEAVY_')&&!key.startsWith('WS_PUSH_')&&!['CI','GITHUB_ACTIONS'].includes(key)));
env.WS_CPU_ROOT=join(root,'cpu');env.VITEST_TMP_ROOT=join(root,'vitest');
/** @param {string} name @param {NodeJS.ProcessEnv} environment */
function run(name,environment){
 const result=spawnSync(process.execPath,['src/scripts/vitest-tmp.ts','run','--config',config,...files,'--reporter=json',`--outputFile.json=${join(root,`${name}.json`)}`],{env:environment,encoding:'utf8',timeout:20000});
 writeFileSync(join(root,`${name}.log`),`${result.stdout??''}${result.stderr??''}`);
 return result;
}
if(mode!=='forged'){
const ordinary=run('ordinary',env);assert.equal(ordinary.status,0,`${ordinary.stdout}${ordinary.stderr}`);
const report=JSON.parse(readFileSync(join(root,'ordinary.json'),'utf8'));assert.equal(report.numPassedTests,3);assert.equal(report.numFailedTests,0);
for(const file of files)assert.equal(readFileSync(`${file}.ran`,'utf8'),'yes');
assert.equal(JSON.parse(readFileSync(join(root,'cpu/queue.json'),'utf8')).cpuActive.length,0);
}
if(mode!=='ordinary'){
const forged=run('forged',{...env,CPU_REUSE_FORGED:'1'});assert.notEqual(forged.status,0);
assert.ok(!`${forged.stdout}${forged.stderr}`.includes('UNTRUSTED_CONTEXT_NOT_ECHOED'));
const refused=JSON.parse(readFileSync(join(root,'forged.json'),'utf8'));assert.equal(refused.numPassedTests,1);assert.equal(refused.numFailedTestSuites,2);
assert.equal(JSON.parse(readFileSync(join(root,'cpu/queue.json'),'utf8')).cpuActive.length,0);
}
console.log(JSON.stringify({mode,actualSharedFiles:3,...(mode==='forged'?{}:{staleOwnedContextsReplaced:true,oneActiveGrantPerFile:true}),...(mode==='ordinary'?{}:{forgedContextsRefused:2,capabilityNeverEchoed:true}),allGrantsReleased:true}));
