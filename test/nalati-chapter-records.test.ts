// oxlint-disable-next-line import/no-nodejs-modules -- Read only the admitted native product and shipped physics module.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import * as v from 'valibot';
import {loadHeadlessFolder} from '../src/server/host/headlessFolder';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {snapshotSimHost,serializeSimSnapshot} from '../src/shared/engine/sim/snapshot';
import {outputDescriptor} from '../src/shared/game/shardfile/outputDescriptor';
import {questObservation} from '../src/shared/game/quest/questObservation';
import {AdventurePersistenceSchema} from '@wildshard/format/namedJsonContracts';
import {parseChapterStoryPresentation} from '@wildshard/format/questStory';
import type {PrepareHeadlessRuntime} from '../src/server/host/headlessRuntime';
import type {SimHost} from '../src/server/engine/sim';
import {builtFolder} from './fixtures/builtFolder';
import {createNativeProofResident,prepareFolderPlan as prepareNalati} from './fixtures/headless-native';
import {prepareChapterRecords,type ChapterRecords} from '../src/server/game/quest/chapterRecords';
import {canonicalSimDigest} from './fake/simState';

test('chapter saved reads borrow actual native records and restore without granting outcomes',async()=>{
  const directory=builtFolder('nalati-grasslands'),product=await loadHeadlessFolder(directory),shard=product.shardfile;
  const descriptor=outputDescriptor(shard);if(descriptor===undefined)throw new Error('Missing admitted native files');
  const assets=new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,
    Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm')),input={product,shard,assets,rapier};
  const install=await prepareChapterRecords(product,{step:'nalati.chapter-records',elites:'nalati.elites'}),owners=new WeakMap<SimHost,ChapterRecords>();
  const prepare:PrepareHeadlessRuntime=async preparation=>{
    const base=await prepareNalati(preparation);
    return {...base,install:(host,context)=>{base.install(host,context);owners.set(host,install(host));}};
  };
  const first=await createNativeProofResident(input,prepare);
  let restored:Awaited<ReturnType<typeof createNativeProofResident>>|undefined;
  try{
    const owner=owners.get(first.host);if(owner===undefined)throw new Error('Missing installed chapter records');
    const rows=v.parse(AdventurePersistenceSchema,await product.json('quests/persistence.json'));
    const field=shard.state.shared.find(row=>row.name===rows.bosses.key);
    if(typeof field?.default!=='string')throw new Error('Missing admitted boss record default');
    const initial:unknown=JSON.parse(field.default);
    expect(owner.bosses.read()).toEqual(initial);
    const elite=first.host.adapters.get('nalati.elites');if(elite===undefined)throw new Error('Missing real native elite continuation');
    const current=v.parse(v.object({records:v.record(v.string(),v.object({kills:v.number()}))}),elite.snapshot()).records;
    expect(owner.elites.read()).toEqual(current);
    expect(()=>install(first.host)).toThrow('unique live native entry');
    const story=parseChapterStoryPresentation(await product.json('quests/chapters.json'));
    const sources=Object.values(story.decision?.observations??{}).map(row=>row.source)
      .filter(source=>'saved'in source&&source.saved.record==='bosses');
    expect(sources.length).toBeGreaterThan(0);
    for(const source of sources){
      if(!('saved'in source))throw new Error('Missing admitted boss observation');
      const read=():number=>questObservation(source,{
      flags:()=>first.host.flags,quest:()=>{throw new Error('No quest read was requested');},
      active:()=>{throw new Error('No chapter read was requested');},saved:()=>owner,
      });
      expect(read()).toBe(Number(owner.bosses.read()[source.saved.id]?.[source.saved.field]??0));
      expect(()=>questObservation(source,{flags:()=>first.host.flags,quest:()=>{throw new Error('Unbound quest');},
        active:()=>null,saved:()=>{throw new Error('Unbound saved owner');}})).toThrow('Unbound saved owner');
    }
    const checkpoint=first.host.adapters.get('nalati.chapter-records');if(checkpoint===undefined)throw new Error('Missing chapter record continuation');
    const before=checkpoint.snapshot();
    expect(()=>checkpoint.restore(JSON.stringify({corrupt:{defeated:true,rewardTaken:false,kills:-1}}))).toThrow();
    expect(checkpoint.snapshot()).toEqual(before);
    for(let tick=0;tick<60;tick++){first.step([]);expect(first.effects).toEqual([]);}
    const saved=snapshotSimHost(first.host);
    restored=await createNativeProofResident(input,prepare,serializeSimSnapshot(saved));
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(saved));
    for(let tick=0;tick<60;tick++){
      first.step([]);restored.step([]);expect(first.effects).toEqual([]);expect(restored.effects).toEqual([]);
    }
    expect(canonicalSimDigest(snapshotSimHost(restored.host))).toBe(canonicalSimDigest(snapshotSimHost(first.host)));
    expect(first.host.flags.all).toEqual([]);
    first.dispose();expect(()=>owner.bosses.read()).toThrow('retired');expect(()=>owner.elites.read()).toThrow('retired');
  }finally{restored?.dispose();first.dispose();}
},30_000);
