// oxlint-disable-next-line import/no-nodejs-modules -- Assert the actual offline command's exit status without a browser.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own temporary seeded readings under the repository scratch directory.
import {mkdirSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- All seeded files stay under repository tmp.
import {resolve,join} from 'node:path';
import {expect,test} from 'vitest';
import {sampledHeapBytes,majorHeapGCs,checkHeapRatchet} from '../scripts/memory/jsHeap.mjs';

const metrics={bootAllocatedBytes:100,settledUsedBytes:50,idleBytesPerSecond:20,majorGCsPer30Seconds:2};
const baseline=()=>({version:1,baselines:{_template:{...metrics}}});
const row=(change:Partial<typeof metrics>={})=>({shard:'_template',metrics:{...metrics,...change}});

test('sampled allocation sums descendants, including anonymous roots and collected samples',()=>{
  expect(sampledHeapBytes({head:{selfSize:0,children:[{selfSize:12,children:[{selfSize:5,children:[]}]}]}})).toBe(17);
  expect(()=>sampledHeapBytes({head:{selfSize:-1,children:[]}})).toThrow();
});

test('major collection phases count once, scaled to thirty seconds',()=>{
  const major={name:'MajorGC',ph:'X',ts:10,pid:1,tid:2};
  expect(majorHeapGCs([major,major,{...major,name:'V8.GCCompactor'},{...major,ts:11,ph:'B'},{...major,ts:12,ph:'E'}],60)).toBe(1);
  expect(()=>majorHeapGCs([],0)).toThrow();
});

test('each metric independently refuses over ten percent and a rebase can never increase limits',()=>{
  for(const key of Object.keys(metrics) as (keyof typeof metrics)[]) {
    expect(checkHeapRatchet([row({[key]:metrics[key]*1.101})],baseline()).passed).toBe(false);
    expect(checkHeapRatchet([row({[key]:metrics[key]*1.01})],baseline(),true).passed).toBe(false);
  }
  expect(checkHeapRatchet([row()],baseline()).passed).toBe(true);
  expect(checkHeapRatchet([row({bootAllocatedBytes:99})],baseline(),true).ratchet.baselines['_template']?.bootAllocatedBytes).toBe(99);
  expect(checkHeapRatchet([row()],{version:1,baselines:{}}).passed).toBe(false);
  expect(checkHeapRatchet([row()],{version:1,baselines:{}},true).passed).toBe(true);
  expect(()=>checkHeapRatchet([],baseline())).toThrow();
  expect(()=>checkHeapRatchet([row(),row()],baseline())).toThrow();
});

test('seeded regression exits one through the existing memory CLI',()=>{
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/heap-regression-'));
  try {
    const report=join(root,'report.json'),limits=join(root,'limits.json');
    writeFileSync(report,JSON.stringify({readings:[row({bootAllocatedBytes:111})]}));
    writeFileSync(limits,JSON.stringify(baseline()));
    const result=spawnSync(process.execPath,['scripts/shard-phone-memory.mjs','heap-check',report,limits],{encoding:'utf8'});
    expect(result.status).toBe(1);expect(result.stdout).toContain('10% regression');
    writeFileSync(report,JSON.stringify({readings:[row()]}));
    expect(spawnSync(process.execPath,['scripts/shard-phone-memory.mjs','heap-check',report,limits]).status).toBe(0);
  }finally{rmSync(root,{recursive:true,force:true});}
});
