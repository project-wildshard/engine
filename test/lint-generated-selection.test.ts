// oxlint-disable-next-line import/no-nodejs-modules -- exercise the real lint file selector
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- own fixture is removed after selection
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- fixture lives in the linted test tree
import { join, resolve } from 'node:path';
import { expect, test } from 'vitest';

test('oxlint skips generated files at every depth while retaining authored source',()=>{
 const directory=mkdtempSync(resolve('test','lint-selection-'));
 try{
  mkdirSync(join(directory,'nested'));
  for(const name of ['authored.ts','nested/authored.mjs','values.generated.ts','nested/values.generated.mjs','nested/values.generated.d.json.ts'])writeFileSync(join(directory,name),'export const value = 1;');
  const result=spawnSync(resolve('node_modules/.bin/oxlint'),['--debug','files',directory],{encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);
  const files=result.stdout.trim().split(/\r?\n/u).map(name=>resolve(name)).sort();
  expect(files).toEqual([join(directory,'authored.ts'),join(directory,'nested/authored.mjs')].sort());
 }finally{rmSync(directory,{recursive:true,force:true});}
});
