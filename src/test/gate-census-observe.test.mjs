import {expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real observer, producer and detached writer fixtures.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Managed per-run scratch.
import {resolve} from 'node:path';

test('TS12e2 the observer qualifies fresh full evidence and retains every refused raw report',()=>{
 const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_')));
 const report=JSON.parse(execFileSync('python3',['src/scripts/gate-census-proof.py','--case','observer','--scratch',resolve(process.env.VITEST_TMP_ROOT??'tmp/vitest')],{env,encoding:'utf8',timeout:30000}));
 expect(report.fixtureOnly).toBe(true);
 expect(report.observerCases).toEqual([
  {mode:'full',qualified:true,exitCode:0,rawRetained:true},
  {mode:'tail-delay',qualified:true,exitCode:0,rawRetained:true},
  ...['docs','related','split','reused','failed'].map(mode=>({mode,qualified:false,exitCode:2,rawRetained:true})),
  ...['missing-log','missing-proof'].map(mode=>({mode,qualified:false,exitCode:2,rawRetained:false,ownerAliveAtRefusal:true})),
  {mode:'legacy',qualified:false,exitCode:0,rawRetained:true},
  {mode:'orphan',qualified:false,exitCode:2,rawRetained:true,writerFinishedNaturally:true},
 ]);
},30000);
