// EG-28: damage real published bodies, then use the actual bounded production child.
// oxlint-disable-next-line import/no-nodejs-modules -- Immutable public fixture and owned run outputs.
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Use the wrapper's per-run temp root and normal pin cache.
import {homedir,tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Hash the actual mutated tar before the worker receives it.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve real worker inputs.
import {join,resolve} from 'node:path';
import {expect,test} from 'vitest';
import {readTar,writeTar} from '@wildshard/format/tar';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {createCookWorker} from '../src/cook/game/cookWorker';
import {folderStore} from '../src/cook/game/packStore';

// The same retained input seed exercises both real tar-body corruption kinds.
const regressionSeeds=JSON.parse(readFileSync('test/pins/fuzz-seeds.json','utf8')) as {cook:number[]};
const seeds=[...new Set((process.env['COOK_FUZZ_SEEDS']??[20261108,...regressionSeeds.cook].join(',')).split(',').map(Number))];
if(seeds.some(seed=>!Number.isSafeInteger(seed)||seed<0||seed>0xffffffff))throw new Error('COOK_FUZZ_SEEDS requires unsigned 32-bit integers');
for(const seed of seeds)for(const kind of ['section','blob'] as const)test(`damaged real ${kind} publishes nothing, seed ${seed}`,async()=>{
  const scratch=mkdtempSync(join(tmpdir(),'hostile-pin-'));
  try {
    const pins=JSON.parse(readFileSync('test/pins/shardfiles.json','utf8')) as {shards:{slug:string;hash:string}[]};
    const pin=pins.shards.find(row=>row.slug==='brasscap-mesa');if(pin===undefined)throw new Error('Missing published Brasscap');
    const files=new Map(readTar(readFileSync(join(process.env['WILDSHARD_PIN_CACHE']??join(homedir(),'.cache/wildshard/pins'),`${pin.hash}.tar`))));
    const header=files.get('shard.json');if(header===undefined)throw new Error('No original header');
    const index=parseOutputIndex(JSON.parse(new TextDecoder().decode(header)));
    const candidates=kind==='section'?index.sections:index.files,row=candidates[(seed>>>0)%candidates.length];
    if(row===undefined)throw new Error('No real body to damage');
    const original=files.get(row.path);if(original===undefined||original.length===0)throw new Error('No original body');
    const damaged=Uint8Array.from(original),at=(seed>>>3)%damaged.length;damaged[at]=(damaged[at]??0)^1;files.set(row.path,damaged);
    const bytes=writeTar(files),hash=createHash('sha256').update(bytes).digest('hex');
    const store=folderStore(join(scratch,'store'));
    const worker=createCookWorker({build:'hostile-pin',store,source:{heads:()=>Promise.resolve([{slug:pin.slug,hash,revision:1}]),download:()=>Promise.resolve(bytes)},
      serverPacks:join(scratch,'server'),scratch:join(scratch,'jobs'),launcher:{root:process.cwd(),execPath:process.execPath,
        loader:resolve('src/scripts/bake-loader.mjs'),script:resolve('src/scripts/cook-job.mjs'),wrap:[],limits:{seconds:5,memoryMB:4096,heapMB:2048}}});
    const result=await worker.cook({slug:pin.slug,hash});
    expect(['refused','failed']).toContain(result.state);expect(await store.list('')).toEqual([]);
  } finally {rmSync(scratch,{recursive:true,force:true});}
},10_000);
