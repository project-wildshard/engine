// oxlint-disable-next-line import/no-nodejs-modules -- Replay uses the shipped native physics binary.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {createSimSnapshotSerializer,snapshotSimHostBytes} from '../src/shared/engine/sim/snapshot';
import {questBooks} from '../src/shared/engine/quest/players';
import {actRoutes} from '../src/shared/engine/sim/actRoutes';
import {loadHeadlessFolder} from '../src/server/host/headlessFolder';
import {openWorld} from '../src/server/host/openWorld';
import {builtFolder,runtimeAssets} from './fixtures/engine-lift/folder';

async function loadChapterInput() {
  const directory=builtFolder('nalati-grasslands'),product=await loadHeadlessFolder(directory);
  return {product,shard:product.shardfile,assets:runtimeAssets(product,directory),rapier:await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))};
}
let inputPromise: ReturnType<typeof loadChapterInput> | undefined;
const CONTINUATION_TICKS = 65;

type ChapterWorld = Awaited<ReturnType<typeof openWorld>>;
function queueChapterFacts(world: ChapterWorld) {
  const resident=world.resident;if(resident===undefined)throw new Error('Missing native resident');
  for(let i=0;i<37;i++)resident.step([]);
  world.host.addPlayer('other');
  actRoutes(world.host).bonded?.('actor.player','1');actRoutes(world.host).bonded?.('other','1');
  return resident;
}

// The room composition must install story continuation before native restore.
// Two books, queued facts and a non-cadence tick must keep their exact suffix.
test('a room resumes both chapter books without re-filing earned facts',async()=>{
  const input=await (inputPromise ??= loadChapterInput());
  const live=await openWorld(input,{room:true}),writer=createSimSnapshotSerializer();
  let back:ChapterWorld|undefined;
  try{
    const resident=queueChapterFacts(live);
    const held=writer.serialize(snapshotSimHostBytes(live.host));
    back=await openWorld(input,{room:true,snapshot:held});
    const resumed=back.resident;if(resumed===undefined)throw new Error('Missing restored resident');
    const immediate=writer.serialize(snapshotSimHostBytes(back.host));
    const a=JSON.parse(immediate).snapshot as Record<string,unknown>,b=JSON.parse(held).snapshot as Record<string,unknown>;
    const differences=Object.keys(a).filter(key=>JSON.stringify(a[key])!==JSON.stringify(b[key]));
    expect(immediate===held,`Immediate continuation differs in ${differences.join(',')}`).toBe(true);
    for(let i=0;i<CONTINUATION_TICKS;i++){
      resident.step([]);resumed.step([]);
      expect(resumed.effects).toEqual(resident.effects);
      if(i===0)expect(resumed.effects.filter(effect=>effect.kind==='fact')).toHaveLength(2);
    }
    expect(writer.serialize(snapshotSimHostBytes(back.host))===writer.serialize(snapshotSimHostBytes(live.host)),'Full continuation differs').toBe(true);
    back.dispose();
    back=undefined;
    back=await openWorld(input,{room:true,snapshot:writer.serialize(snapshotSimHostBytes(live.host))});
    const second=back.resident;if(second===undefined)throw new Error('Missing second resumed resident');
    resident.step([]);second.step([]);
    expect(second.effects).toEqual(resident.effects);
    expect(second.effects.filter(effect=>effect.kind==='fact')).toHaveLength(0);
  }finally{back?.dispose();live.dispose();writer.dispose();}
},30_000);

test('a restored room keeps silent imports and recovers historical chapter facts',async()=>{
  const input=await (inputPromise ??= loadChapterInput());
  const writer=createSimSnapshotSerializer();
  let back:ChapterWorld|undefined,legacy:ChapterWorld|undefined;
  try{
    // Recreate the same checkpoint independently so this case can run alone.
    const live=await openWorld(input,{room:true});
    let checkpoint:string;
    try{
      const resident=queueChapterFacts(live);
      for(let i=0;i<CONTINUATION_TICKS;i++)resident.step([]);
      checkpoint=writer.serialize(snapshotSimHostBytes(live.host));
    }finally{live.dispose();}
    back=await openWorld(input,{room:true,snapshot:checkpoint});
    const resumed=back.resident;if(resumed===undefined)throw new Error('Missing restored resident');
    resumed.step([]);
    const books=questBooks(back.host),record=books.exportOf('other');
    // A newly connected seat imports flags silently; its line must read
    // those flags before deciding or capturing a continuation.
    record.flags.push('talked:elder','won:kokpar');
    books.importOf('other',record);
    // An unrelated notification cannot acknowledge the silent import.
    books.of('other').flags.set('seen:chapter-import-regression');
    const flagsBeforeCapture=books.of('other').flags.all;
    expect(books.of('other').flags.has('feat:kokpar:1')).toBe(false);
    const importedWire=writer.serialize(snapshotSimHostBytes(back.host));
    expect(books.of('other').flags.all).toEqual(flagsBeforeCapture);
    expect(books.of('other').flags.has('feat:kokpar:1')).toBe(false);
    const importedAdapter=(JSON.parse(importedWire).snapshot.adapters as {id:string;state:string}[]).find(row=>row.id==='story.chapters');
    expect(JSON.parse(String(importedAdapter?.state)).owed).toEqual([]);
    const importedWorld=await openWorld(input,{room:true,snapshot:importedWire});
    try{
      expect(writer.serialize(snapshotSimHostBytes(importedWorld.host))===importedWire,'Immediate imported-book capture differs').toBe(true);
      const importedResident=importedWorld.resident;if(importedResident===undefined)throw new Error('Missing imported resident');
      resumed.step([]);importedResident.step([]);
      expect(importedResident.effects).toEqual(resumed.effects);
      expect(books.of('other').flags.has('feat:kokpar:1')).toBe(true);
      expect(writer.serialize(snapshotSimHostBytes(importedWorld.host))===writer.serialize(snapshotSimHostBytes(back.host)),'Imported-book suffix differs').toBe(true);
    }finally{importedWorld.dispose();}
    const adapter=back.host.adapters.get('story.chapters');if(adapter===undefined)throw new Error('Missing chapter continuation');
    const before=adapter.snapshot();
    const imported=JSON.parse(String(before)) as {seats:{player:string;chapters:{started:boolean;currentId:string|null}[]}[]};
    expect(imported.seats.find(seat=>seat.player==='other')?.chapters[0]?.started).toBe(true);if(typeof before!=='string')throw new Error('Missing chapter wire');
    const wrongClock=JSON.parse(before) as {now:number};wrongClock.now=-1;
    expect(()=>adapter.restore(JSON.stringify(wrongClock))).toThrow();
    expect(adapter.snapshot()).toBe(before);
    const wrongPlayer=JSON.parse(before) as {seats:{player:string}[]};wrongPlayer.seats[0]!.player='absent';
    expect(()=>adapter.restore(JSON.stringify(wrongPlayer))).toThrow();
    expect(adapter.snapshot()).toBe(before);
    // A historical save held flags but no story outbox. A feat earned
    // just before saving must reach the durable ledger on the next tick.
    const old=snapshotSimHostBytes(back.host);
    legacy=await openWorld(input,{room:true,snapshot:writer.serialize({...old,adapters:old.adapters.filter(row=>row.id!=='story.chapters')})});
    const converted=writer.serialize(snapshotSimHostBytes(legacy.host));
    legacy.dispose();legacy=undefined;
    legacy=await openWorld(input,{room:true,snapshot:converted});
    const historical=legacy.resident;if(historical===undefined)throw new Error('Missing legacy resident');
    historical.step([]);
    const facts=historical.effects.flatMap(effect=>effect.kind==='fact'?[`${effect.name}:${effect.actorId}`]:[]);
    expect(facts).toContain('nalati.feat.tame:feat.tame.1');
    expect(facts).toContain('nalati.feat.tame:other:feat.tame.1');
    expect(facts).toContain('nalati.feat.kokpar:other:feat.kokpar.1');
    historical.step([]);
    expect(historical.effects.filter(effect=>effect.kind==='fact')).toHaveLength(0);
    expect(legacy.host.removePlayer('other')).toBe(true);historical.step([]);
    legacy.host.addPlayer('other');historical.step([]);
    const returned=legacy.host.adapters.get('story.chapters')?.snapshot();
    const rejoined=JSON.parse(String(returned)) as {seats:{player:string;chapters:{started:boolean}[]}[]};
    expect(rejoined.seats).toHaveLength(2);
    expect(rejoined.seats.find(seat=>seat.player==='other')?.chapters[0]?.started).toBe(false);
    back.dispose();back=undefined;
    expect(()=>adapter.snapshot()).toThrow(/retired/u);
  }finally{legacy?.dispose();back?.dispose();writer.dispose();}
},30_000);
