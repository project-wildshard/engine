// oxlint-disable-next-line import/no-nodejs-modules -- Parent canonical-state comparison needs the same native physics binary.
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The consumer owns an isolated cwd and its output mount.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Match the worker's packaged physics binary, without a public asset copy.
import {createRequire} from 'node:module';
import {loadRapier} from '@wildshard/engine/physics/rapier';
import {expect,test} from 'vitest';
import {emptyShardfile} from '@wildshard/engine/host/author';
import {createNativeProofWorker} from '@wildshard/engine/test/headless-worker';
import {canonicalSimDigest} from '@wildshard/engine/test/simState';
import {builtFolder} from '@wildshard/engine/test/builtFolder';
import {beginFolderSession} from '@wildshard/engine/test/headless/folderSession';

test('a consumer prepare URL owns an isolated native world and its exact continuation', async()=>{
  await loadRapier(readFileSync(createRequire(import.meta.url).resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm')));
  const shard=emptyShardfile({slug:'consumer-proof',name:'Consumer',author:'Test',revision:1,seed:7});
  const prepare=new URL('./fixtures/headless/nativeRuntime.ts',import.meta.url);
  const worker=await createNativeProofWorker(shard,new Map(),prepare);
  let restored:Awaited<ReturnType<typeof createNativeProofWorker>>|undefined;
  try{
    let coins=0;
    for(let tick=0;tick<20;tick++){
      const commit=await worker.step([]);coins+=commit.effects.filter(effect=>effect.kind==='coins').length;
    }
    expect(coins).toBe(1);
    const snapshot=worker.checkpoint?.snapshot;
    if(snapshot===undefined)throw new Error('Missing native checkpoint');
    restored=await createNativeProofWorker(shard,new Map(),prepare,{snapshot});
    const actual=await worker.step([]),continuation=await restored.step([]);
    expect(canonicalSimDigest(continuation.snapshot)).toBe(canonicalSimDigest(actual.snapshot));
    expect(continuation.effects).toEqual(actual.effects);
  }finally{await restored?.dispose();await worker.dispose();}
});

test('the worker refuses non-file prepare URLs and modules without the prepare export',async()=>{
  const shard=emptyShardfile({slug:'refused-proof',name:'Refused',author:'Test',revision:1,seed:1});
  await expect(createNativeProofWorker(shard,new Map(),new URL('https://example.invalid/proof.ts'))).rejects.toThrow('file URL');
  await expect(createNativeProofWorker(shard,new Map(),new URL('../src/test/game/headless/checkedReplayPipeline.ts',import.meta.url))).rejects.toThrow('needs prepareHeadlessRuntime');
  await expect(createNativeProofWorker(shard,new Map(),new URL('./fixtures/headless/nativeRuntime.ts',import.meta.url),{snapshot:'not-a-native-save'})).rejects.toThrow();
  expect(()=>builtFolder('../foreign')).toThrow('Invalid built product name');
});

test('the exported session reads a consumer output and refuses corrupt admitted bytes',async()=>{
  const root=process.cwd(),product=builtFolder('_template'),prepare=new URL('./fixtures/headless/nativeRuntime.ts',import.meta.url);
  mkdirSync('tmp/codex-tc48',{recursive:true});
  const consumer=mkdtempSync(resolve('tmp/codex-tc48/consumer-'));
  let sim:Awaited<ReturnType<Awaited<ReturnType<typeof beginFolderSession>>['ready']>>|undefined;
  try{
    mkdirSync(resolve(consumer,'out'));symlinkSync(product,resolve(consumer,'out/_template'),'dir');
    process.chdir(consumer);
    expect(builtFolder('_template')).toBe(resolve(consumer,'out/_template'));
    const session=await beginFolderSession('_template',{prepare});
    sim=await session.ready();
    expect((await sim.step([])).tick).toBe(1);
    const file=session.product.shardfile.files.find(row=>(session.assets.get(row.hash)?.length??0)>0);
    if(file===undefined)throw new Error('Missing product bytes for admission control');
    const assets=new Map(session.assets),original=assets.get(file.hash);
    if(original===undefined)throw new Error('Missing admitted bytes');
    const corrupt=original.slice();corrupt[0]=(corrupt[0]??0)^255;assets.set(file.hash,corrupt);
    await expect(createNativeProofWorker(session.product.shardfile,assets,prepare)).rejects.toThrow();
  }finally{await sim?.dispose();process.chdir(root);rmSync(consumer,{recursive:true,force:true});}
});
