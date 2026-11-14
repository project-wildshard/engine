import {fixtureFolderFile,fixtureJsonCheck} from './fixtures/folderFile';
import {nalatiWetBlock} from './fixtures/nalati-wet';
import {lendNalatiPasture} from './fixtures/nalati-return-modules';
import { createShardFolder, type ShardFolder } from '../src/shared/game/shardfile/shardFolder';
import { emptyShardfile } from '../src/shared/host/author';
import { expect, test, vi } from 'vitest';
import { BufferGeometry, Scene, Vector3 } from 'three';
import { App } from '../src/client/engine/app/app';
import { app } from '../src/client/engine/app/runtime';
import { Scope } from '../src/shared/engine/app/scope';
import type { AnimalManager } from '../src/server/engine/entities/AnimalManager';
import type { Player } from '../src/client/engine/player/Player';
import * as boot from '../src/client/engine/boot/plan';
import * as crowdPage from '../src/client/game/ambient/pageCrowds';
import type { PreparedCrowds } from '../src/shared/game/shardfile/crowdRuntime';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { ShardRuntime } from '../src/shared/game/shard/runtime';
import { PageWildlifeView, installClientWildlife } from '../src/client/game/population/wildlifeFeature';
import { clientWildlife } from '../src/shared/game/population/wildlifeOwner';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import { NALATI_HEADLESS_ASSEMBLY as headlessAssembly } from './fixtures/nalati-headless-assembly';
import { admittedSheepFolder } from './fake/admittedSheep';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

const feature = parseClientPlan({ version: 1, features: [{ kind: 'population.wildlife', file: 'actors/wildlife.json',
  crowd: { json: 'actors/sheep.json', binary: 'actors/sheep.bin' }, navSteer: true,
  frame: { id: 'orchard.wildlife', after: ['orchard.places'], before: ['engine.creatures.update'] } }] }).features[0];

test('declared wildlife waits for animals, owns one frame and retires its hook', async () => {
  if (feature?.kind !== 'population.wildlife') throw new Error('Missing feature');
  const scope = new Scope('orchard.wildlife');scope.expose(app,'levelScope',scope);lendNalatiPasture(scope);
  const application = new App(), baseline=application.events.census().answerers, systems: Parameters<ShardContext['system']>[0][] = [];
  const native = legacyDouble<PreparedCrowds>({ policies: new Map(), advance: vi.fn<PreparedCrowds['advance']>() });
  vi.spyOn(crowdPage, 'createPageCrowds').mockReturnValue(legacyDouble<ReturnType<typeof crowdPage.createPageCrowds>>({ runtime: native }));
  const pause = vi.spyOn(boot, 'macrotask').mockResolvedValue();
  const begin = vi.spyOn(PageWildlifeView.prototype, 'beginFrame').mockReturnValue(0), end = vi.spyOn(PageWildlifeView.prototype, 'endFrame').mockReturnValue();
  const rows = { ...headlessAssembly.constants.pageWildlife, packs: [], herds: [], flocks: [], mountables: [], foragers: null };
  const hooks: ShardRuntime['hooks'] = {};
  const runtime = legacyDouble<ShardRuntime>({ hooks, world: legacyDouble<NonNullable<ShardRuntime['world']>>({
    game: legacyDouble<NonNullable<ShardRuntime['world']>['game']>({ scene: new Scene(),levelScope:scope }),
    sky: legacyDouble<NonNullable<ShardRuntime['world']>['sky']>({}), chunk: legacyDouble<NonNullable<ShardRuntime['world']>['chunk']>({ seed: 7 }),
    player: legacyDouble<Player>({ position: new Vector3(), yaw: .4, crouching: true }) }) });
  const real = admittedSheepFolder(), encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));
  const metadata = {...real.metadata,draws:real.metadata.draws.map(row=>({...row,slot:feature.crowd.binary,file:feature.crowd.binary}))};
  const readJson = vi.fn<ShardFolder['file']>(hash=>Promise.resolve(hash==='wet'?nalatiWetBlock.bytes:hash==='population'?encode(rows):hash==='crowd'?encode(metadata):real.bytes));
  const fixture = createShardFolder({ slug: 'orchard', revision: 1, shardfile: emptyShardfile({ slug: 'orchard', name: 'Orchard', author: 'Fixture', revision: 1, seed: 7 }), sections: new Map(), files: new Map([[nalatiWetBlock.file,fixtureFolderFile(nalatiWetBlock.file,{hash:'wet',url:'/wet'})],[feature.file, fixtureFolderFile(feature.file,{ hash: 'population', url: '/population' })], [feature.crowd.json, fixtureFolderFile(feature.crowd.json,{ hash: 'crowd', url: '/crowd' })], [feature.crowd.binary,{hash:'body',url:'/body'}]]), read: readJson,jsonCheck:fixtureJsonCheck });
  const ctx = legacyDouble<ShardContext>({ answer:(name,handler)=>{application.events.answer(name,handler,scope);}, scope, app: application, game: legacyDouble<ShardContext['game']>({ runtime }), system: row => { systems.push(row); },
    product: fixture });
  const animals = legacyDouble<AnimalManager>({ animals: [], herds: [], wetAt: () => false, navSteer: false, factory: legacyDouble<AnimalManager['factory']>({ *prepareSteps() { /* no bodies in this fixture */ } }) });
  try {
    expect(() => clientWildlife(ctx)).toThrow('not installed');
    const hits:string[]=[];
    const request={origin:new Vector3(),dir:new Vector3(0,0,1),maxDist:10,hit:null};
    application.events.answer('combat.targets.ray',value=>{hits.push('prior');return value;},scope);
    const ray=vi.spyOn(PageWildlifeView.prototype,'raycastWeapon').mockImplementation((_origin,_direction,_maximum,prior)=>{hits.push('wildlife');return prior;});
    await installClientWildlife(ctx, feature);
    const body = vi.mocked(crowdPage.createPageCrowds).mock.calls[0]?.[2];
    if(body===undefined)throw new Error('Missing real fixed-draw body');
    expect(body.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(body.geometry.boundingSphere?.radius).toBe(metadata.radius);
    expect(body.pivots).toEqual(metadata.pivots);expect(body.parts).toEqual(metadata.parts);
    const disposed=vi.spyOn(body.geometry,'dispose');
    application.events.answer('combat.targets.ray',value=>{hits.push('night');return value;},scope);
    application.events.answer('combat.targets.ray',value=>{hits.push('titan');return value;},scope);
    application.events.ask('combat.targets.ray',request);expect(hits).toEqual(['prior','night','titan']);hits.length=0;
    expect(clientWildlife(ctx)).toBeNull(); expect(systems).toHaveLength(1);
    const frame = systems[0]; if (frame === undefined) throw new Error('Missing frame');
    expect(frame).toMatchObject({ id: 'orchard.wildlife', after: ['orchard.places'], before: ['engine.creatures.update'] });
    frame.run(.1, 2); expect(begin).not.toHaveBeenCalled();
    const build = hooks.animalsBuilt; if (build === undefined) throw new Error('Missing animal stage');
    await build(animals); expect(pause).toHaveBeenCalledTimes(2); expect(clientWildlife(ctx)).toBeInstanceOf(PageWildlifeView);
    application.events.ask('combat.targets.ray',request);expect(hits).toEqual(['prior','wildlife','night','titan']);hits.length=0;
    expect(ray).toHaveBeenCalledWith(request.origin,request.dir,request.maxDist,null);
    frame.run(.1, 3);
    expect(begin).toHaveBeenCalledWith(.1, expect.objectContaining({ crouching: true }), { mounted: false });
    expect(end).toHaveBeenCalledOnce();
    await expect(build(animals)).rejects.toThrow('unavailable');
    await expect(installClientWildlife(ctx, feature)).rejects.toThrow('owner');
    scope.dispose();expect(disposed).toHaveBeenCalledOnce();application.events.ask('combat.targets.ray',request);expect(hits).toEqual([]); expect(hooks.animalsBuilt).toBeUndefined(); expect(() => clientWildlife(ctx)).toThrow('disposed');
    const entered=new Scope('orchard.reentry');lendNalatiPasture(entered);
    try{
      const stale=legacyDouble<ShardContext>({...ctx,scope:entered});
      await expect(installClientWildlife(stale,feature)).rejects.toThrow('Return owner disposed');
      expect(hooks.animalsBuilt).toBeUndefined();expect(application.events.census().answerers).toBe(baseline);
      const world=runtime.world;if(world===null)throw new Error('Missing original wildlife world');
      const nextRuntime=legacyDouble<ShardRuntime>({...runtime,world:{...world,
        game:legacyDouble<typeof world.game>({scene:world.game.scene,levelScope:entered})}});
      const next=legacyDouble<ShardContext>({...ctx,scope:entered,game:legacyDouble<ShardContext['game']>({runtime:nextRuntime}),
        answer:(name,handler)=>{application.events.answer(name,handler,entered);}});
      await installClientWildlife(next,feature);
      application.events.answer('combat.targets.ray',value=>{hits.push('reentered');return value;},entered);
      application.events.ask('combat.targets.ray',request);expect(hits).toEqual(['reentered']);
      expect(application.events.census().answerers).toBe(baseline+2);
      const rebuilt=nextRuntime.hooks.animalsBuilt;if(rebuilt===undefined)throw new Error('Missing reentered animal stage');
      await rebuilt(animals);expect(clientWildlife(next)).toBeInstanceOf(PageWildlifeView);
    }finally{entered.dispose();}
    expect(application.events.census().answerers).toBe(baseline);
  } finally { scope.dispose(); vi.restoreAllMocks(); }
});

test('wildlife rows refuse callbacks and reflected ordering knobs', () => {
  if (feature?.kind !== 'population.wildlife') throw new Error('Missing feature');
  for (const row of [{ ...feature, frame: { id: 'orchard.frame', after: [], before: [], rank: 2 } },
    { ...feature, file: () => 'actors/wildlife.json' }, { ...feature, owner: 'borrowed', path: ['population'] }])
    expect(() => parseClientPlan({ version: 1, features: [row] })).toThrow();
});

test('wildlife retains joint/bound guards and refuses retired fixed-draw intake', async () => {
  if(feature?.kind!=='population.wildlife')throw new Error('Missing feature');
  const original=admittedSheepFolder();
  const metadata={...original.metadata,draws:original.metadata.draws.map(row=>({...row,slot:feature.crowd.binary,file:feature.crowd.binary}))};
  const encode=(value:unknown):Uint8Array=>new TextEncoder().encode(JSON.stringify(value));
  const create=(owner:Scope,body:typeof metadata,readBody:()=>Promise<Uint8Array>):ShardContext=>{
    lendNalatiPasture(owner);
    const identity={slug:'orchard',name:'Orchard',author:'Fixture',revision:1,seed:7};
    const product=createShardFolder({slug:identity.slug,revision:1,shardfile:emptyShardfile(identity),sections:new Map(),
      // Simulate a build-validated read so the unchanged native joint/bound
      // checks are reached even when these controls corrupt an admitted row.
      builtJson:true,
      files:new Map([[nalatiWetBlock.file,fixtureFolderFile(nalatiWetBlock.file,{hash:'wet',url:'/wet'})],[feature.file,fixtureFolderFile(feature.file,{hash:'population',url:'/population'})],[feature.crowd.json,fixtureFolderFile(feature.crowd.json,{hash:'crowd',url:'/crowd'})],[feature.crowd.binary,{hash:'body',url:'/body'}]]),
      read:hash=>hash==='wet'?Promise.resolve(nalatiWetBlock.bytes):hash==='population'?Promise.resolve(encode(headlessAssembly.constants.pageWildlife)):hash==='crowd'?Promise.resolve(encode(body)):readBody()});
    return legacyDouble<ShardContext>({scope:owner,app:new App(),product,
      game:legacyDouble<ShardContext['game']>({runtime:legacyDouble<ShardRuntime>({hooks:{},world:legacyDouble<NonNullable<ShardRuntime['world']>>({
        game:legacyDouble<NonNullable<ShardRuntime['world']>['game']>({levelScope:owner})})})})});
  };
  for(const bad of [{...metadata,parts:[]},{...metadata,parts:['one']},{...metadata,radius:0},{...metadata,radius:-1},{...metadata,draws:[]}]){
    const scope=new Scope('orchard.invalid'),read=vi.fn(()=>Promise.resolve(original.bytes));
    try{await expect(installClientWildlife(create(scope,bad,read),feature)).rejects.toThrow('joints or bound');expect(read).not.toHaveBeenCalled();}
    finally{scope.dispose();}
  }
  const scope=new Scope('orchard.closing');
  let complete:(value:Uint8Array)=>void=()=>undefined,started:()=>void=()=>undefined;
  const pending=new Promise<Uint8Array>(resolve=>{complete=resolve;}),reading=new Promise<void>(resolve=>{started=resolve;});
  const ctx=create(scope,metadata,()=>{started();return pending;}),dispose=vi.spyOn(BufferGeometry.prototype,'dispose');
  try{
    const install=installClientWildlife(ctx,feature);await reading;scope.dispose();const before=dispose.mock.calls.length;complete(original.bytes);
    await expect(install).rejects.toThrow('owner left');expect(dispose.mock.calls.length-before).toBe(1);
    expect(ctx.game.runtime?.hooks.animalsBuilt).toBeUndefined();
  }finally{scope.dispose();dispose.mockRestore();}
});
