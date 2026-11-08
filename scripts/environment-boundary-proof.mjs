// Actual project selection and runtime refusal; outside test/hook discovery.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {linkNodeModules} from './link-node-modules.mjs';

const directory=resolve(process.argv[2]??'tmp/environment-boundary-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-'));
try{
 linkNodeModules(process.cwd(),work);writeFileSync(join(work,'package.json'),'{"type":"module"}');
 writeFileSync(join(work,'native.test.mjs'),"import{expect,test}from'vitest';import{Vector3}from'three';test('native math has no document',()=>{expect(typeof document).toBe('undefined');expect(new Vector3(1,2,3).lengthSq()).toBe(14)});");
 writeFileSync(join(work,'page.test.mjs'),"// @vitest-environment happy-dom\nimport{expect,test}from'vitest';test('page owns its document',()=>expect(document.createElement('div').tagName).toBe('DIV'));");
 const events=join(work,'events.txt');
 for(let index=0;index<4;index++)writeFileSync(join(work,`overlap-${index}.test.mjs`),`${index%2===0?'// @vitest-environment happy-dom\n':''}import{test}from'vitest';import{appendFileSync}from'node:fs';test('real worker overlap',async()=>{appendFileSync(${JSON.stringify(events)},'+\\n');await new Promise(resolve=>setTimeout(resolve,100));appendFileSync(${JSON.stringify(events)},'-\\n')});`);
 const helper=pathToFileURL(resolve('scripts/vitest-environments.ts')).href,config=join(work,'vitest.config.mjs');
 writeFileSync(config,`import{withTestEnvironments}from'${helper}';export default withTestEnvironments({root:${JSON.stringify(work)},test:{include:['*.test.mjs'],cache:false,fsModuleCache:false,maxWorkers:2}});`);
 const run=()=>spawnSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','--root',work,'--config',config],{cwd:work,encoding:'utf8',timeout:10000,env:{...process.env,TMPDIR:work,NODE_COMPILE_CACHE:join(work,'compile')}});
 const passed=run();assert.equal(passed.status,0,`${passed.stdout}\n${passed.stderr}`);assert.match(passed.stdout,/6 passed/u);
 let active=0,maximum=0;for(const event of readFileSync(events,'utf8').trim().split('\n')){active+=event==='+'?1:-1;maximum=Math.max(maximum,active);}
 assert.equal(active,0);assert.equal(maximum,2,'Node and DOM projects must share the configured two-worker bound');
 writeFileSync(join(work,'wrong.test.mjs'),"import{test}from'vitest';test('unowned document refuses',()=>document.createElement('div'));");
 const refused=run();assert.notEqual(refused.status,0);assert.match(refused.stderr,/document is not defined/u);
 writeFileSync(join(work,'unknown.test.mjs'),"// @vitest-environment unknown-owner\nimport{test}from'vitest';test('unknown environment',()=>{});");
 const unknown=run();assert.notEqual(unknown.status,0);assert.match(unknown.stderr,/Unsupported test environment unknown-owner/u);
 console.log(JSON.stringify({nativeMath:true,pageDOM:true,maxWorkers:maximum,unownedDOMRefused:true,unknownOwnerRefused:true}));
}finally{rmSync(work,{recursive:true,force:true});}
