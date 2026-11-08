// The public cook worker runs the real pinned tar through its bounded child.
// No synthetic cook implementation or injected simulation proof.
// oxlint-disable-next-line import/no-nodejs-modules -- Native process and filesystem boundary.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Each case owns and removes its store and job folders.
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The test wrapper gives each run an isolated temp root.
import {tmpdir,homedir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the normal worker's executable and immutable pin.
import {join,resolve} from 'node:path';
import {expect,test} from 'vitest';
import {createCookWorker} from '../src/cook/game/cookWorker';
import {folderStore} from '../src/cook/game/packStore';

for (const limit of ['bytes','time'] as const) test(`real cook ${limit} refusal publishes nothing`,async()=>{
  const root=process.cwd(),scratch=mkdtempSync(join(tmpdir(),'cook-refusal-'));
  try {
    const pins=JSON.parse(readFileSync('test/pins/shardfiles.json','utf8')) as {shards:{slug:string;hash:string}[]};
    const pin=pins.shards.find(row=>row.slug==='template');if(pin===undefined)throw new Error('Missing template pin');
    const bytes=readFileSync(join(process.env['WILDSHARD_PIN_CACHE']??join(homedir(),'.cache/wildshard/pins'),`${pin.hash}.tar`));
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(pin.hash);
    const store=folderStore(join(scratch,'store')),worker=createCookWorker({build:'bounded-proof',store,
      source:{heads:()=>Promise.resolve([{...pin,revision:1}]),download:()=>Promise.resolve(bytes)},
      serverPacks:join(scratch,'server'),scratch:join(scratch,'jobs'),
      launcher:{root,execPath:process.execPath,loader:resolve('scripts/bake-loader.mjs'),script:resolve('scripts/cook-job.mjs'),wrap:[],
        limits:{seconds:limit==='time'?.001:5,memoryMB:4096,heapMB:2048,...limit==='bytes'?{maxBytes:bytes.length-1}:{}}}});
    const result=await worker.cook(pin);
    expect(result.state,result.detail).toBe(limit==='bytes'?'refused':'failed');
    expect(await store.list('')).toEqual([]);
  } finally {rmSync(scratch,{recursive:true,force:true});}
},10_000);
