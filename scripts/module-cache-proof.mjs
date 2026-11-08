// A real cached import must follow a root package retag without changing its caller.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {linkNodeModules} from './link-node-modules.mjs';

const directory=resolve(process.argv[2]??'tmp/module-cache-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-'));
try{
  linkNodeModules(process.cwd(),work);
  for(const value of [1,2])writeFileSync(join(work,`value-${value}.mjs`),`export const value=${value};`);
  writeFileSync(join(work,'subject.mjs'),"export{value}from'#choice';");
  writeFileSync(join(work,'actual.test.mjs'),"import{expect,test}from'vitest';import{value}from'./subject.mjs';test('retagged public import',()=>expect(value).toBe(Number(process.env.WS_EXPECTED)));");
  const plugin=pathToFileURL(resolve('scripts/vitest-module-cache.ts')).href;
  const config=join(work,'vitest.config.mjs');
  writeFileSync(config,`import{vitestModuleCache}from'${plugin}';export default{plugins:[vitestModuleCache()],test:{cache:false,fsModuleCache:true,fsModuleCachePath:${JSON.stringify(join(work,'transforms'))},maxWorkers:1,include:['actual.test.mjs']}};`);
  const timings=[];
  for(const value of [1,1,2]){
    writeFileSync(join(work,'package.json'),JSON.stringify({type:'module',imports:{'#choice':`./value-${value}.mjs`}}));
    const start=performance.now(),result=spawnSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','--root',work,'--config',config],{
      cwd:work,encoding:'utf8',timeout:10000,env:{...process.env,TMPDIR:work,NODE_COMPILE_CACHE:join(work,'compile'),WS_EXPECTED:String(value)}});
    assert.equal(result.status,0,`${result.stdout}\n${result.stderr}`);timings.push(Math.round(performance.now()-start));
  }
  console.log(JSON.stringify({cold:true,warm:true,retag:true,milliseconds:timings}));
}finally{rmSync(work,{recursive:true,force:true});}
