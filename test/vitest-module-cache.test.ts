import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real child runs verify persistent transform invalidation and mock isolation.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Every fixture and cache belongs to one bounded checkout scratch directory.
import {mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,statSync,utimesSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the installed runner and owned scratch paths.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Child runs use this exact Node runtime and environment.
import process from 'node:process';

test('persistent transforms retain mocks and invalidate same-size edits and aliases',()=>{
 const root=mkdtempSync(resolve('tmp','vitest-module-cache-')),cache=resolve(root,'cache'),config=resolve(root,'vitest.config.mjs');
 const writeConfig=(target:string)=>writeFileSync(config,`export default {root:${JSON.stringify(root)},resolve:{alias:{'fixture-target':${JSON.stringify(resolve(root,target))}}},test:{include:['sample.test.ts'],setupFiles:[],maxWorkers:1,fsModuleCache:true,fsModuleCachePath:${JSON.stringify(cache)}}};`);
 const source=resolve(root,'value.ts');
 const run=(value:string,alias:string)=>{const child=spawnSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','sample.test.ts','--config',config],{
  cwd:root,encoding:'utf8',timeout:20000,env:{...process.env,DEBUG:'vitest:cache:fs',EXPECT_VALUE:value,EXPECT_ALIAS:alias,TMPDIR:resolve(root,'temp'),NODE_COMPILE_CACHE:resolve(root,'compile')},stdio:['ignore','pipe','pipe'],
 });
  expect(child.status,child.stdout+child.stderr).toBe(0);return child.stdout+child.stderr;
 };
 try {
  mkdirSync(resolve(root,'temp'));
  writeConfig('first.ts');
  writeFileSync(source,'export const value: number = 17;');
  writeFileSync(resolve(root,'first.ts'),"export const value = 'first';");
  writeFileSync(resolve(root,'other.ts'),"export const value = 'other';");
  writeFileSync(resolve(root,'mocked.ts'),"throw new Error('Mock was not hoisted');");
  writeFileSync(resolve(root,'sample.test.ts'),`import {test,expect,vi} from 'vitest';
import {value} from './value';
import {value as alias} from 'fixture-target';
import {token} from './mocked';
vi.mock('./mocked',()=>({token:'mocked'}));
test('executes current source and hoisted mock',async()=>{
 expect(value).toBe(Number(process.env.EXPECT_VALUE));
 expect((await import('./value')).value).toBe(value);
 expect(alias).toBe(process.env.EXPECT_ALIAS);
 expect(token).toBe('mocked');
});`);
  expect(run('17','first')).toContain('1 passed');
  const cold=readdirSync(cache).sort(),contents=cold.map(name=>readFileSync(resolve(cache,name)));
  expect(cold.length).toBeGreaterThan(1);
  const warm=run('17','first');expect(warm).toContain('1 passed');expect(warm).toContain('[read]');
  expect(readdirSync(cache).sort()).toEqual(cold);
  expect(cold.map(name=>readFileSync(resolve(cache,name)))).toEqual(contents);
  const timestamp=statSync(source);
  writeFileSync(source,'export const value: number = 29;');
  utimesSync(source,timestamp.atime,timestamp.mtime);
  expect(run('29','first')).toContain('1 passed');
  expect(readdirSync(cache).length).toBeGreaterThan(cold.length);
  writeConfig('other.ts');
  expect(run('29','other')).toContain('1 passed');
 }finally{rmSync(root,{recursive:true,force:true});}
},30000);

test('warm typed glob transforms follow file deletion, addition and raw edits',()=>{
 const root=mkdtempSync(resolve('tmp','vitest-glob-cache-')),cache=resolve(root,'cache'),config=resolve(root,'vitest.config.mjs');
 const guard=resolve('scripts/vitest-module-cache.ts');
 const run=(names:string,value:string)=>{
  const child=spawnSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','sample.test.ts','--config',config],{
   cwd:root,encoding:'utf8',timeout:20000,env:{...process.env,DEBUG:'vitest:cache:fs',EXPECT_NAMES:names,EXPECT_RAW:value,TMPDIR:resolve(root,'temp'),NODE_COMPILE_CACHE:resolve(root,'compile')},stdio:['ignore','pipe','pipe'],
  });
  expect(child.status,child.stdout+child.stderr).toBe(0);return child.stdout+child.stderr;
 };
 try{
  mkdirSync(resolve(root,'temp'));mkdirSync(resolve(root,'parts'));
  writeFileSync(config,`import {vitestModuleCache} from ${JSON.stringify(guard)};
export default {root:${JSON.stringify(root)},plugins:[vitestModuleCache()],test:{include:['sample.test.ts'],setupFiles:[],maxWorkers:1,fsModuleCache:true,fsModuleCachePath:${JSON.stringify(cache)}}};`);
  writeFileSync(resolve(root,'stable.ts'),'export const stable = 17;');
  writeFileSync(resolve(root,'parts/first.ts'),'export const first = 1;');
  writeFileSync(resolve(root,'parts/other.ts'),'export const other = 2;');
  writeFileSync(resolve(root,'sample.test.ts'),`import {test,expect} from 'vitest';
import {stable} from './stable';
const files = import.meta.glob<string>('./parts/*.ts',{eager:true,query:'?raw',import:'default'});
test('enumerates current raw sources',()=>{
 expect(stable).toBe(17);
 expect(Object.keys(files).sort().join(',')).toBe(process.env.EXPECT_NAMES);
 expect(files['./parts/first.ts']).toBe(process.env.EXPECT_RAW);
});`);
  const initial='./parts/first.ts,./parts/other.ts';
  expect(run(initial,'export const first = 1;')).toContain('1 passed');
  expect(run(initial,'export const first = 1;')).toContain('[read]');
  rmSync(resolve(root,'parts/other.ts'));
  expect(run('./parts/first.ts','export const first = 1;')).toContain('1 passed');
  writeFileSync(resolve(root,'parts/third.ts'),'export const third = 3;');
  expect(run('./parts/first.ts,./parts/third.ts','export const first = 1;')).toContain('1 passed');
  writeFileSync(resolve(root,'parts/first.ts'),'export const first = 9;');
  expect(run('./parts/first.ts,./parts/third.ts','export const first = 9;')).toContain('1 passed');
 }finally{rmSync(root,{recursive:true,force:true});}
},30000);
