import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Drive the real broker and original native test files.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep every fixture in the run's owned scratch.
import {resolve} from 'node:path';

test('cold native suites queue before collection and keep their original cases',()=>{
 const report=JSON.parse(execFileSync(process.execPath,['scripts/native-contention-proof.mjs',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest','native-contention')],{encoding:'utf8',timeout:90000}));
 expect(report).toEqual({files:[
  {file:'test/net-fuzz.test.ts',queuedBeforeCollection:true,originalCasesPassed:true},
  {file:'test/physics-nalati-headless.test.ts',queuedBeforeCollection:true,originalCasesPassed:true},
  {file:'test/physics-shards-headless.test.ts',queuedBeforeCollection:true,originalCasesPassed:true},
 ],allGrantsReleased:true});
},90000);
