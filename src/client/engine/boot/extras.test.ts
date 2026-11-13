// @vitest-environment happy-dom
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {bootFiles,extraFetches,startDeferredAudioPreload,startMenuPreload,startLateAudio} from './extras';
import {setBootCatalog,type BootLevel} from './catalog';
import {prepareBootAudio} from './audioInventory';
import {declareTotals,installByteCounter,releaseByteCounter,type ChunkFiles} from './bytes';
import {installAssetTables,type AssetTables} from '../../../shared/engine/boot/tables';
import {NO_AUDIO,type LevelAudioProfile,type LevelAudioBank} from '../audio/levelAudio';
import {createBootPlan,type StepProgress} from './plan';
import * as settings from '../ui/Settings';
import {LoadingTimeline,installLoadingTimeline} from '../../../shared/engine/boot/timeline';
import {loadingWaitState} from '../../../shared/engine/boot/loadingWaits';
import {STEP_INFO} from '../../../shared/engine/boot/steps';
import { TIER, initializeTier } from '../core/tier';

const music='/assets/music/folk/title.m4a',sfx='/assets/sfx/field/step.m4a';
const foreignMusic='/assets/music/electronic/other.m4a',foreignSfx='/assets/sfx/other/unused.m4a';
const all={music:[foreignMusic,music],sfx:[foreignSfx,sfx]};
const blank:ChunkFiles={sky:[],baked:[],terrain:[],trees:[],cabins:[],props:[],physics:[],art:[],music:[],sfx:[]};
const level:BootLevel={slug:'fixture',card:{thumb:'data:,',portrait:'data:,',landscape:'data:,'},
  boot:{files:[],sources:()=>blank,audio:[...all.music,...all.sfx]}};
const bank:LevelAudioBank={title:undefined,score:{slots:new Map(),stings:new Map()},cues:{loops:new Map(),shots:new Map()}};
const profile:LevelAudioProfile={files:()=>all,bootFiles:genre=>genre==='folk'?[music,sfx]:[foreignMusic,foreignSfx],decode:()=>Promise.resolve(bank)};
const priorTables:AssetTables={bytes:{},versions:{},music:{},sfx:{},packs:{}};
const tableSlot = Symbol.for('engine.asset-tables');
const previousTables = Object.getOwnPropertyDescriptor(globalThis, tableSlot);
beforeEach(()=>{
  setBootCatalog({levels:[level],playable:[level],find:()=>level,artBytes:{}});
  installAssetTables({...priorTables,bytes:{[music]:3,[sfx]:3,[foreignMusic]:100,[foreignSfx]:100}});
  vi.spyOn(settings,'getMusicStyle').mockReturnValue('folk');
});
afterEach(() => {
  if (previousTables === undefined) Reflect.deleteProperty(globalThis, tableSlot);
  else Object.defineProperty(globalThis, tableSlot, previousTables);
});

test('boot declares only selected profile audio while background inventory retains every style',async()=>{
  await prepareBootAudio(level.boot);
  const active=bootFiles(level,'img',profile),background=bootFiles(level,'img');
  expect(active.music).toEqual([music]);expect(active.sfx).toEqual([sfx]);
  expect(extraFetches(active)).toEqual([music,sfx]);
  expect(background.music).toEqual(all.music);expect(background.sfx).toEqual(all.sfx);
  expect(declareTotals(active)).toMatchObject({music:{bytes:3,files:1},sfx:{bytes:3,files:1}});
  expect(declareTotals(background)).toMatchObject({music:{bytes:103,files:2},sfx:{bytes:103,files:2}});
  expect(bootFiles(level,'img',NO_AUDIO)).toMatchObject({music:[],sfx:[]});
  vi.mocked(settings.getMusicStyle).mockReturnValue('piano');
  expect(bootFiles(level,'img',profile)).toMatchObject({music:[foreignMusic],sfx:[foreignSfx]});
});

test('selected extras retain their exact source totals without foreign styles',()=>{
  const files={...blank,art:['/assets/card.webp'],music:[music],sfx:[sfx]};
  installAssetTables({...priorTables,bytes:{[music]:3,[sfx]:3,'/assets/card.webp':7,[foreignMusic]:100,[foreignSfx]:100}});
  try {
    const totals = declareTotals(files), plan = createBootPlan(()=>undefined,{totals});
    installByteCounter(plan,files);
    expect(totals).toMatchObject({art:{bytes:7,files:1},music:{bytes:3,files:1},sfx:{bytes:3,files:1}});
    expect(plan.view.bytesRead).toBe(0);
  } finally {releaseByteCounter();}
});

test('active boot declares its own card; Explorer previews stay in background inventory',()=>{
  const own={thumb:'/assets/own-thumb.jpg',portrait:'/assets/own-portrait.jpg',landscape:'/assets/own-landscape.jpg'};
  const foreign={thumb:'/assets/other-thumb.jpg',portrait:'/assets/other-portrait.jpg',landscape:'/assets/other-landscape.jpg'};
  const home:BootLevel={...level,card:own,boot:{...level.boot,files:[],sources:()=>blank,explore:{art:['/assets/own-explore.webp']}}};
  const other:BootLevel={...level,slug:'other',card:foreign};
  const artBytes={ [own.thumb]:10,[own.portrait]:20,[own.landscape]:30,'/assets/own-explore.webp':40,
    [foreign.thumb]:1000,[foreign.portrait]:2000,[foreign.landscape]:3000 };
  setBootCatalog({levels:[other,home],playable:[other,home],find:()=>home,artBytes});
  const files=bootFiles({...home},'img',NO_AUDIO);
  const activeArt=TIER==='phone'?[own.thumb,innerWidth>=innerHeight?own.landscape:own.portrait]:Object.values(own);
  expect(files.art).toEqual(activeArt);
  expect(extraFetches(files)).toEqual(files.art);
  expect(declareTotals(files).art).toEqual({bytes:activeArt.reduce((sum,path)=>sum+(artBytes[path]??0),0),files:activeArt.length});
  const background=bootFiles(home,'img');
  expect(background.art).toEqual([...Object.values(own),'/assets/own-explore.webp']);
  expect(declareTotals(background).art).toEqual({bytes:100,files:4});
  expect(other.card).toBe(foreign);expect(other.card.portrait).toBe('/assets/other-portrait.jpg');
});

test('an explicitly required boot image stays eager even when it is also Explorer art',()=>{
  const critical='/assets/required.webp';
  const home:BootLevel={...level,boot:{...level.boot,files:[],sources:()=>blank,
    explore:{art:[critical]},precache:[critical]}};
  setBootCatalog({levels:[home],playable:[home],find:()=>home,artBytes:{[critical]:7}});
  expect(bootFiles(home,'img',NO_AUDIO).art).toEqual([critical]);
});

test('grid omits unused menu cards while keeping explicit art and original audio routing',()=>{
  const card={thumb:'/assets/thumb.jpg',portrait:'/assets/portrait.jpg',landscape:'/assets/landscape.jpg'};
  const home:BootLevel={...level,card,boot:{...level.boot,files:[],sources:()=>blank,precache:[card.portrait,'/assets/required.webp']}};
  const artBytes={[card.thumb]:10,[card.portrait]:20,[card.landscape]:30,'/assets/required.webp':40};
  setBootCatalog({levels:[home],playable:[home],find:()=>home,artBytes});
  const grid=bootFiles(home,'img',profile,false);
  expect(grid.art).toEqual([card.portrait,'/assets/required.webp']);
  expect(declareTotals(grid).art).toEqual({bytes:60,files:2});
  expect(grid.music).toEqual([music]);expect(grid.sfx).toEqual([sfx]);
  expect(extraFetches(grid)).toEqual([...grid.art,music,sfx]);
  const active=TIER==='phone'?[card.thumb,innerWidth>=innerHeight?card.landscape:card.portrait]:Object.values(card);
  expect(bootFiles(home,'img',profile).art).toEqual([...new Set([...active,card.portrait,'/assets/required.webp'])]);
  expect(bootFiles(home,'img').art).toEqual([...Object.values(card),'/assets/required.webp']);
});

test('active phone menu art follows orientation while background and desktop retain both originals',()=>{
  const prior=TIER;
  const card={thumb:'/assets/orientation-thumb.jpg',portrait:'/assets/orientation-portrait.jpg',landscape:'/assets/orientation-landscape.jpg'};
  const home:BootLevel={...level,card},artBytes={[card.thumb]:10,[card.portrait]:20,[card.landscape]:30};
  setBootCatalog({levels:[home],playable:[home],find:()=>home,artBytes});
  try{
    initializeTier('phone');
    vi.stubGlobal('innerWidth',402);vi.stubGlobal('innerHeight',874);
    expect(bootFiles(home,'img',NO_AUDIO).art).toEqual([card.thumb,card.portrait]);
    expect(declareTotals(bootFiles(home,'img',NO_AUDIO)).art).toEqual({bytes:30,files:2});
    vi.stubGlobal('innerWidth',874);vi.stubGlobal('innerHeight',402);
    expect(bootFiles(home,'img',NO_AUDIO).art).toEqual([card.thumb,card.landscape]);
    expect(bootFiles(home,'img').art).toEqual(Object.values(card));
    initializeTier('desktop');
    expect(bootFiles(home,'img',NO_AUDIO).art).toEqual(Object.values(card));
    expect(home.card).toBe(card);
  }finally{vi.unstubAllGlobals();initializeTier(prior);}
});

test('preload ignores foreign inventory and decodes selected compressed bytes offline without another fetch',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(()=>Promise.resolve(new Response(new Uint8Array([1,2,3]))));
  const seen:string[]=[],decode=vi.fn<LevelAudioProfile['decode']>(async(style,read)=>{
    expect(style).toBe('folk');
    for(const url of [music,sfx]){
      seen.push(url);const first=await read(url);
      expect(new Uint8Array(first)).toEqual(new Uint8Array([1,2,3]));new Uint8Array(first).fill(9);
      expect(new Uint8Array(await read(url))).toEqual(new Uint8Array([1,2,3]));
    }return bank;
  });
  const preload=startDeferredAudioPreload({...blank,...all},level,{...profile,decode});
  const progress:StepProgress={set:vi.fn<StepProgress['set']>(),detail:()=>undefined};await preload.wait(progress);
  expect(fetch.mock.calls.map(([url])=>url)).toEqual([music,sfx]);
  expect(progress.set).toHaveBeenLastCalledWith(2,2,'2 / 2 audio files');
  fetch.mockImplementation(()=>Promise.reject(new Error('Offline')));
  const decoded=await preload.decode();expect(decoded.profile).toBe(bank);expect(await preload.decode()).toBe(decoded);
  expect(decode).toHaveBeenCalledOnce();expect(seen).toEqual([music,sfx]);expect(fetch).toHaveBeenCalledTimes(2);
});

test('missing audio retains synth fallback and an asset-free profile reads nothing',async()=>{
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(()=>Promise.resolve(new Response(null,{status:404})));
  const missing=startDeferredAudioPreload({...blank,...all},level,profile);
  await missing.wait({set:()=>undefined,detail:()=>undefined});expect((await missing.decode()).profile).toBe(bank);
  expect(fetch).toHaveBeenCalledTimes(2);
  const empty=startDeferredAudioPreload({...blank,...all},level,NO_AUDIO);
  await empty.wait({set:()=>undefined,detail:()=>undefined});await empty.decode();
  expect(fetch).toHaveBeenCalledTimes(2);
});

test('QA 11-12 row 36: an unreachable network retries once, then waits on RETRY naming the file, never in flight for good',async()=>{
  let offline=true;
  const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(()=>offline?Promise.reject(new TypeError('Failed to fetch')):Promise.resolve(new Response(new Uint8Array([1]))));
  const preload=startDeferredAudioPreload({...blank,...all},level,profile);
  await vi.waitFor(()=>{expect([...loadingWaitState().pending.values()].filter(row=>row.retry!==undefined&&row.retry!==null).map(row=>row.resource)).toEqual(expect.arrayContaining([music,sfx]));});
  expect(fetch,'one attempt and the one retry each').toHaveBeenCalledTimes(4);
  const wait=[...loadingWaitState().pending.values()].find(row=>row.resource===music);
  expect(wait?.label).toContain('/assets/music/folk/title.m4a');expect(wait?.label).toContain('connection unavailable');
  offline=false;wait?.retry?.();
  await preload.wait({set:()=>undefined,detail:()=>undefined});expect((await preload.decode()).profile).toBe(bank);
  expect(fetch).toHaveBeenCalledTimes(6);
});

test('G1000: the phone bar reads and decodes the whole boot audio set before control, with no late load',async()=>{
  const prior=TIER;initializeTier('phone');
  try{
    installAssetTables({...priorTables,bytes:{[music]:3,[sfx]:3}});
    const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(input=>Promise.resolve(new Response(input===sfx?new Uint8Array([4,5,6]):new Uint8Array([1,2,3]))));
    const decoded=vi.fn<LevelAudioProfile['decode']>(async(_style,read)=>{
      expect([...new Uint8Array(await read(music))]).toEqual([1,2,3]);
      expect([...new Uint8Array(await read(sfx))]).toEqual([4,5,6]);
      return bank;
    });
    // a profile that still names a control subset and a title track (I7) gets its whole boot set anyway, and the full
    // decode, called as the session's data stage calls it on a direct play (sp-x9: no late title music either)
    const control=vi.fn<NonNullable<LevelAudioProfile['controlDecode']>>(()=>Promise.resolve(bank));
    const selected={...profile,controlFiles:()=>[music],titleFiles:()=>[music],controlDecode:control,decode:decoded};
    const files=bootFiles(level,'img',selected,true),preload=startDeferredAudioPreload(files,level,selected);
    await preload.wait({set:()=>undefined,detail:()=>undefined});await preload.decode();
    expect(new Set(fetch.mock.calls.map(([input])=>input))).toEqual(new Set([music,sfx]));
    expect(decoded).toHaveBeenCalledTimes(1); expect(control).not.toHaveBeenCalled();
    expect(startLateAudio(files)).toBeUndefined();
  }finally{initializeTier(prior);}
});

test('direct phone play holds title-only audio and later decodes the same bytes',async()=>{
  const prior=TIER;initializeTier('phone');
  try {
    const fetch=vi.spyOn(globalThis,'fetch').mockImplementation(input=>Promise.resolve(new Response(input===music?new Uint8Array([7,8,9]):new Uint8Array([1,2,3]))));
    const decode=vi.fn<LevelAudioProfile['decode']>(async(_style,read)=>{
      expect([...new Uint8Array(await read(music))]).toEqual([7,8,9]);
      expect([...new Uint8Array(await read(sfx))]).toEqual([1,2,3]);
      return bank;
    });
    const selected={...profile,titleFiles:()=>[music],controlDecode:()=>Promise.resolve(bank),decode};
    const normal=bootFiles(level,'img',selected),files=bootFiles(level,'img',selected,true,true);
    expect(normal.music).toEqual([music]);expect(files.music).toEqual([]);expect(files.sfx).toEqual([sfx]);
    const preload=startDeferredAudioPreload(files,level,selected);
    await preload.wait({set:()=>undefined,detail:()=>undefined});await preload.decode();
    expect(fetch.mock.calls.map(([input])=>input)).toEqual([sfx]);
    expect((await startLateAudio(files))?.profile).toBe(bank);
    expect(decode).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls.map(([input])=>input)).toEqual([sfx,music]);
    initializeTier('desktop');
    expect(bootFiles(level,'img',selected,true,true).music).toEqual([music]);
  } finally {initializeTier(prior);}
});

test('the declared audio-download row owns its original parallel reads before the later audio wait',async()=>{
  const timeline=new LoadingTimeline({id:'fixture',steps:[
    {key:'data',label:STEP_INFO.menu.label,weight:1},{key:'audioFiles',label:STEP_INFO.audio.label,weight:1},
    {key:'world',label:STEP_INFO.props.label,weight:1},
  ]},0,()=>100);
  const restore=installLoadingTimeline(timeline), data=timeline.begin('data'),complete:(()=>void)[]=[];
  vi.spyOn(globalThis,'fetch').mockImplementation(()=>new Promise<Response>(resolve=>{
    complete.push(()=>{resolve(new Response(new Uint8Array([1,2,3])));});
  }));
  try{
    const preload=startDeferredAudioPreload({...blank,...all},level,profile);
    data.end();const world=timeline.begin('world');
    await vi.waitFor(()=>{expect(complete).toHaveLength(2);});
    expect(timeline.snapshot().display).toBe('audioFiles');
    expect(timeline.snapshot().rows.find(row=>row.key==='audioFiles')?.state).toBe('on');
    for(const finish of complete)finish();
    await preload.wait({set:()=>undefined,detail:()=>undefined});
    expect(timeline.snapshot().rows.find(row=>row.key==='audioFiles')).toMatchObject({state:'ok',fraction:2/3});
    expect(timeline.snapshot().display).toBe('world');
    world.end();
  }finally{restore();}
});


test('menu preparation counts pictures without reserving UI module work',async()=>{
  const home:BootLevel={...level,boot:{...level.boot,files:[],explore:{art:[]}}};
  const set=vi.fn<StepProgress['set']>();
  await startMenuPreload(blank,home).wait({set,detail:()=>undefined});
  expect(set).toHaveBeenLastCalledWith(0,0,'0 / 0 pictures');
});
