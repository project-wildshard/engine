// oxlint-disable-next-line import/no-nodejs-modules -- exercise the exact CLI with an isolated compiler
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- own fixture lives under the repository scratch directory
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- resolve fixture paths without shell quoting
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- select the current Node runtime
import { env, execPath } from 'node:process';
import { expect, test } from 'vitest';

test('local checks reuse the scenario build, CI forces checks and failures propagate',()=>{
 mkdirSync('tmp',{recursive:true});const fixture=mkdtempSync(resolve('tmp','root-check-'));
 try{
  mkdirSync(resolve(fixture,'scripts'));mkdirSync(resolve(fixture,'node_modules/.bin'),{recursive:true});
  writeFileSync(resolve(fixture,'scripts/typecheck-root.mjs'),readFileSync('scripts/typecheck-root.mjs'));
  writeFileSync(resolve(fixture,'node_modules/.bin/tsc'),`#!/usr/bin/env node\nrequire('node:fs').writeFileSync('args.json',JSON.stringify(process.argv.slice(2)));process.exit(Number(process.env.COMPILER_STATUS??0));\n`,{mode:0o755});
  const run=(environment:Record<string,string>,args:string[]=[])=>spawnSync(execPath,['scripts/typecheck-root.mjs',...args],{cwd:fixture,encoding:'utf8',env:{PATH:env['PATH']??'',...environment}});
  expect(run({}).status).toBe(0);
  expect(JSON.parse(readFileSync(resolve(fixture,'args.json'),'utf8'))).toEqual(['-b','test/tsconfig.json','--builders','1']);
  for(const environment of [{CI:'true'},{GITHUB_ACTIONS:'true'}]){
   expect(run(environment).status).toBe(0);expect(JSON.parse(readFileSync(resolve(fixture,'args.json'),'utf8'))).toEqual(['-b','test/tsconfig.json','--builders','1','--force']);
  }
  expect(run({COMPILER_STATUS:'7'}).status).toBe(7);
  expect(run({},['--project','other']).status).toBe(2);
 }finally{rmSync(fixture,{recursive:true,force:true});}
});
