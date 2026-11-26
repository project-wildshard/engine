import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixtureScratch} from '../src/test/.kit/owned-scratch.mjs';
import {t1Scope} from '../src/scripts/t1-qualification.mjs';

test('proof and runner changes each invalidate prior T1 qualification',()=>{
 const root=fixtureScratch('t1-scope');
 mkdirSync(join(root,'src/e2e/t1'),{recursive:true});mkdirSync(join(root,'src/scripts'),{recursive:true});
 writeFileSync(join(root,'src/e2e/t1/boot.spec.ts'),'fixture suite');
 for(const file of ['t1-shards.mjs','t1-ci-proof.mjs','t1-e2e.mjs','t1-runner.mjs'])writeFileSync(join(root,'src/scripts',file),'original');
 let before=t1Scope(root);
 for(const file of ['t1-ci-proof.mjs','t1-e2e.mjs','t1-runner.mjs']){
  writeFileSync(join(root,'src/scripts',file),'changed');
  const after=t1Scope(root);assert.notEqual(after,before,file);before=after;
 }
});
