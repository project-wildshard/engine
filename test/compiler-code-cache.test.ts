// oxlint-disable-next-line import/no-nodejs-modules -- Real process boundaries for the pure transform memo.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Owned cache fixtures.
import {mkdirSync,mkdtempSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Bounded fixture paths.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Exact Node binary.
import process from 'node:process';
import {afterEach,expect,it} from 'vitest';
import * as v from 'valibot';

const owned:string[]=[];
afterEach(()=>{for(const directory of owned.splice(0))rmSync(directory,{recursive:true,force:true});});
it('reuses pure normalization across processes and repairs corrupt records',()=>{
  mkdirSync('tmp',{recursive:true});const cache=mkdtempSync(resolve('tmp/compiler-code-cache-'));owned.push(cache);
  const module=resolve('scripts/compiler-code.mjs');
  const run=(source:string)=>{
    const program=`import{createHash}from'node:crypto';import{compilerCodeHash}from${JSON.stringify(module)};
      const bytes=new TextEncoder().encode(process.argv[1]);let reads=0;
      const result=compilerCodeHash('cache-fixture.ts',createHash('sha256').update(bytes).digest('hex'),()=>{reads++;return bytes;});console.log(JSON.stringify({result,reads}));`;
    return v.parse(v.object({result:v.string(),reads:v.number()}),JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',program,source],{env:{...process.env,WILDSHARD_COMPILER_CODE_CACHE:cache},encoding:'utf8'})));
  };
  const source='/** initial docs */ export const value=1;',first=run(source);expect(first.reads).toBe(1);expect(run(source)).toEqual({...first,reads:0});
  for(const file of readdirSync(cache))writeFileSync(resolve(cache,file),'{}');
  expect(run(source)).toEqual(first);expect(run(source)).toEqual({...first,reads:0});
  expect(run(source.replace('initial docs','changed docs')).result).toBe(first.result);
  expect(run(source.replace('value=1','value=2')).result).not.toBe(first.result);
});
