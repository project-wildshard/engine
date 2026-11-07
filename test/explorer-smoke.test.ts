// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { explorerCards, explorerCapture, explorerCases, explorerPartition, explorerFailures, explorerState, sweepExplorer, openExplorerSession, verifyExplorerDocument, explorerDiagnostics } from '../scripts/parity/explorer-smoke.mjs';
import type { Browser, BrowserContext, CDPSession, Page } from 'playwright';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
// oxlint-disable-next-line import/no-nodejs-modules -- Verify the actual required workflow leg, without dispatching it.
import { readFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';

const catalogue = [
  {slug:'driftwood-isle',status:'live',legacy:false},
  {slug:'sunscar-dunes',status:'experimental',legacy:false},
  {slug:'nine-dragon-stack',status:'experimental',legacy:false},
  {slug:'_template',status:'hidden',legacy:false},
  {slug:'open-plot-alien-plain',status:'hidden',legacy:false,shardSelect:false},
  {slug:'nine-dragon-stack-legacy',status:'live',legacy:true},
];
const currentDocument={url:'https://test.example/?chunk=fixture',timeOrigin:1,slug:'fixture'};
const diagnostics={document:currentDocument,timingBufferFull:false,navigation:null,resources:[],measures:[]};
function storageFixture() {
  const storage=legacyDouble<CDPSession>({send:()=>Promise.reject(new Error('Unconfigured protocol response'))});
  const send=vi.spyOn(storage,'send').mockResolvedValue({});return {storage,send};
}

function fixtureBrowser(evaluate: Page['evaluate']): { browser: Browser; close: ReturnType<typeof vi.fn<BrowserContext['close']>> } {
  const page: Page = legacyDouble<Page>({ evaluate, on: () => page,
    goto: vi.fn<Page['goto']>().mockResolvedValue(null),
    screenshot: vi.fn<Page['screenshot']>().mockRejectedValue(new Error('No browser capture in the unit fixture')) });
  const close = vi.fn<BrowserContext['close']>().mockResolvedValue(undefined);
  const disposable = { dispose: (): Promise<void> => Promise.resolve(), [Symbol.asyncDispose]: (): Promise<void> => Promise.resolve() };
  const context = legacyDouble<BrowserContext>({
    newCDPSession: vi.fn<BrowserContext['newCDPSession']>().mockResolvedValue({ ...storageFixture().storage }),
    addInitScript: vi.fn<BrowserContext['addInitScript']>().mockResolvedValue(disposable),
    route: vi.fn<BrowserContext['route']>().mockResolvedValue(disposable),
    newPage: vi.fn<BrowserContext['newPage']>().mockResolvedValue({ ...page }), close,
  });
  return { browser: legacyDouble<Browser>({ newContext: vi.fn<Browser['newContext']>().mockResolvedValue({ ...context }) }), close };
}

test.each(['progress', 'stalled', 'fatal', 'black'] as const)('Explorer no-progress hang guard retains complete pixels and fatal refusal (%s)', async mode => {
  mkdirSync('tmp/sp-x7-live', { recursive: true });
  const out = mkdtempSync('tmp/sp-x7-live/explorer-hang-');
  let now = 0;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now);
  const evaluate = vi.fn<Page['evaluate']>();
  const first = { id: 'first', ready: true, pixels: 100, darkShare: .2 };
  const last = { ...first, id: 'last', darkShare: mode === 'black' ? .9 : .2 };
  evaluate.mockImplementationOnce(() => {
    now = 120000;
    return Promise.resolve({ document:currentDocument,fatal: [], empty: false, ready: false, readyIds: ['first'] });
  }).mockImplementationOnce(() => {
    now = 240000;
    return Promise.resolve({ document:currentDocument,fatal: mode === 'fatal' ? ['real fault'] : [], empty: false, ready: false,
      readyIds: mode === 'stalled' ? ['first'] : ['first', 'middle'] });
  }).mockImplementationOnce(() => {
    now = 360000;
    return Promise.resolve({ document:currentDocument,fatal: [], empty: false, ready: mode !== 'stalled',
      readyIds: mode === 'stalled' ? ['first'] : ['first', 'middle', 'last'] });
  }).mockResolvedValueOnce({cards:[first, { ...first, id: 'middle' }, last],
    before:{document:currentDocument,fatal:[],empty:false,ready:true,readyIds:['first','middle','last']},
    after:{document:currentDocument,fatal:[],empty:false,ready:true,readyIds:['first','middle','last']}})
    .mockResolvedValue(diagnostics);
  const { browser, close } = fixtureBrowser(evaluate);
  try {
    if (mode === 'progress') {
      await sweepExplorer(browser, 'https://test.example/', 'fixture', out);
      const receipt: unknown = JSON.parse(readFileSync(`${out}/fixture.json`, 'utf8'));
      expect(receipt).toMatchObject({ elapsedMs: 360000, hangMs: 180000, failures: [],
        firstReadyMs: { first: 120000, middle: 240000, last: 360000 } });
    } else {
      const refusal = mode === 'stalled' ? 'stalled for 180 seconds without progress'
        : mode === 'fatal' ? 'Explorer fatal: real fault' : 'last: thumbnail is at least 90% near-black';
      await expect(sweepExplorer(browser, 'https://test.example/', 'fixture', out)).rejects.toThrow(refusal);
    }
    expect(close).toHaveBeenCalledOnce();
  } finally { clock.mockRestore(); rmSync(out, { recursive: true, force: true }); }
});

test('progress records only appended canvases and still requires the whole displayed catalogue', () => {
  document.body.innerHTML='<div class="ws-x show" data-mode="model"><div class="ws-x-grid"><button class="ws-x-model" data-id="first"><canvas></canvas></button><button class="ws-x-model" data-id="pending"></button></div></div>';
  try {
    expect(explorerState()).toMatchObject({fatal:[],empty:false,ready:false,readyIds:['first']});
    const pending=document.querySelector('[data-id="pending"]');
    if(pending===null)throw new Error('Missing pending card');
    pending.append(document.createElement('canvas'));
    expect(explorerState()).toMatchObject({fatal:[],empty:false,ready:true,readyIds:['first','pending']});
    document.querySelector('.ws-x')?.classList.remove('show');
    expect(explorerState()).toMatchObject({fatal:[],empty:false,ready:false,readyIds:[]});
  } finally { document.body.replaceChildren(); }
});

test.each(['state', 'pixels'] as const)('a stuck %s read refuses within the unchanged progress budget', async mode => {
  mkdirSync('tmp/sp-x9-explorer', { recursive: true });
  const out = mkdtempSync('tmp/sp-x9-explorer/stopped-renderer-');
  vi.useFakeTimers();
  const evaluate = vi.fn<Page['evaluate']>();
  if (mode === 'pixels') evaluate.mockResolvedValueOnce({ document:currentDocument,fatal: [], empty: false, ready: true, readyIds: ['first'] });
  evaluate.mockImplementation(() => new Promise(() => { /* The renderer never returns a protocol result. */ }));
  const { browser, close } = fixtureBrowser(evaluate);
  try {
    const refusal = expect(sweepExplorer(browser, 'https://test.example/', 'fixture', out))
      .rejects.toThrow('stalled for 180 seconds without progress');
    await vi.advanceTimersByTimeAsync(180001);
    await refusal;
    expect(evaluate).toHaveBeenCalledTimes(mode === 'state' ? 1 : 2);
    expect(close).toHaveBeenCalledOnce();
    const receipt: unknown = JSON.parse(readFileSync(`${out}/fixture-failure.json`, 'utf8'));
    expect(receipt).toMatchObject({ hangMs: 180000, cards: [] });
  } finally { vi.useRealTimers(); rmSync(out, { recursive: true, force: true }); }
});

test('the Explorer leg retains every primary, including Signal and Developer-only rows, once', () => {
  expect(explorerCases(catalogue)).toEqual(['driftwood-isle','nine-dragon-stack','sunscar-dunes','_template','open-plot-alien-plain']);
  const workflow = readFileSync('.github/workflows/deploy.yml','utf8');
  const journeys=workflow.split('\n  journeys:\n')[1]?.split('\n  boot-verdict:\n')[0];
  if(journeys===undefined)throw new Error('Missing browser journey');
  expect(workflow).not.toContain('\n  phone-route:\n');
  const parts=/part: \[([^\]]+)\]/u.exec(journeys)?.[1]?.split(',').map(part=>part.trim());
  if(parts===undefined)throw new Error('Missing browser journey matrix');
  expect(parts).toEqual(['explorer','boot-public','developer-webkit','grid-chromium']);
  expect(new Set(parts).size).toBe(parts.length);expect(parts).not.toContain('phone-route');
  expect(journeys).not.toContain('continue-on-error:');
  expect(workflow).toContain(`if: \${{ !cancelled() && steps.inputs.outcome == 'success' && matrix.part == 'explorer' }}`);
  expect(workflow).toContain('run: node scripts/parity/explorer-smoke.mjs --case-group=all');
  expect(workflow).toContain('needs: [prepare, typecheck-lint, behaviour, native-escape, journeys, stage-prebuilt]');
});

test('missing, failed, duplicate and black card frames refuse with their real model identity', () => {
  const ready={id:'signal/column',ready:true,pixels:100,darkShare:.89};
  expect(explorerFailures([ready])).toEqual([]);
  expect(explorerFailures([{...ready,darkShare:.9}])).toEqual(['signal/column: thumbnail is at least 90% near-black']);
  expect(explorerFailures([{...ready,ready:false}])).toEqual(['signal/column: thumbnail never drew']);
  expect(explorerFailures([ready,ready])).toContain('Missing or duplicate model identity');
  expect(explorerFailures([{...ready,darkShare:Number.NaN}])).toHaveLength(1);
});

test('the observation reads the ordinary already-drawn card canvas, including an undrawn suffix', () => {
  document.body.innerHTML='<div class="ws-x-grid"><button class="ws-x-model" data-id="signal/column"><canvas width="4" height="1"></canvas></button><button class="ws-x-model" data-id="pending"></button></div>';
  const canvas=document.querySelector('canvas');if(canvas===null)throw new Error('Missing fixture');
  const context=legacyDouble<CanvasRenderingContext2D>({getImageData:()=>({data:Uint8ClampedArray.from([0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255]),width:4,height:1,colorSpace:'srgb'})});
  const getter=vi.spyOn(canvas,'getContext').mockReturnValue(context);
  try {
    const rows=explorerCards();
    expect(rows).toEqual([{id:'signal/column',ready:true,pixels:1,darkShare:1},{id:'pending',ready:false,pixels:0,darkShare:1}]);
    expect(explorerFailures(rows)).toHaveLength(2);
    expect(getter).toHaveBeenCalledExactlyOnceWith('2d');
  } finally { getter.mockRestore();document.body.replaceChildren(); }
});

test('a model-ready invalidation between presence and pixels waits for the replacement canvas', async () => {
  mkdirSync('tmp/sp-x7-live', { recursive: true });
  const out = mkdtempSync('tmp/sp-x7-live/explorer-redraw-');
  const evaluate = vi.fn<Page['evaluate']>();
  const state = { document:currentDocument,fatal: [], empty: false, ready: true, readyIds: ['shared/training-dummy'] };
  const missing = { id: 'shared/training-dummy', ready: false, pixels: 0, darkShare: 1 };
  const drawn = { ...missing, ready: true, pixels: 100, darkShare: .2 };
  evaluate.mockResolvedValueOnce(state).mockResolvedValueOnce({before:{...state,ready:false},cards:[missing],after:{...state,ready:false}})
    .mockResolvedValueOnce(state).mockResolvedValueOnce({before:state,cards:[drawn],after:state})
    .mockResolvedValueOnce(diagnostics);
  const page: Page = legacyDouble<Page>({ evaluate, on: () => page,
    goto: vi.fn<Page['goto']>().mockResolvedValue(null),
    close: vi.fn<Page['close']>().mockResolvedValue(),
    screenshot: vi.fn<Page['screenshot']>().mockRejectedValue(new Error('Unexpected failure capture')) });
  const close = vi.fn<BrowserContext['close']>().mockResolvedValue(undefined);
  const disposable = { dispose: (): Promise<void> => Promise.resolve(), [Symbol.asyncDispose]: (): Promise<void> => Promise.resolve() };
  const context = legacyDouble<BrowserContext>({
    newCDPSession: vi.fn<BrowserContext['newCDPSession']>().mockResolvedValue({ ...storageFixture().storage }),
    addInitScript: vi.fn<BrowserContext['addInitScript']>().mockResolvedValue(disposable),
    route: vi.fn<BrowserContext['route']>().mockResolvedValue(disposable),
    newPage: vi.fn<BrowserContext['newPage']>().mockResolvedValue({ ...page }),
    close,
  });
  const browser = legacyDouble<Browser>({ newContext: vi.fn<Browser['newContext']>().mockResolvedValue({ ...context }) });
  try {
    await sweepExplorer(browser, 'https://test.example/', 'fixture', out);
    const receipt: unknown = JSON.parse(readFileSync(`${out}/fixture.json`, 'utf8'));
    expect(receipt).toMatchObject({ cards: [drawn], failures: [] });
    expect(evaluate.mock.calls.filter(([fn])=>fn===explorerCapture)).toHaveLength(2);
    expect(close).toHaveBeenCalledOnce();
  } finally { rmSync(out, { recursive: true, force: true }); }
});

test('a ready catalogue must belong to the requested new world document',()=>{
  expect(()=>verifyExplorerDocument(currentDocument,'https://test.example/','fixture',undefined)).not.toThrow();
  for(const observed of [
    {...currentDocument,slug:'previous'},
    {...currentDocument,url:'https://test.example/?chunk=previous'},
    {...currentDocument,url:'https://foreign.example/?chunk=fixture'},
    {...currentDocument,timeOrigin:Number.NaN},
  ])expect(()=>verifyExplorerDocument(observed,'https://test.example/','fixture',undefined)).toThrow('stale or foreign');
  expect(()=>verifyExplorerDocument(currentDocument,'https://test.example/','fixture',1)).toThrow('stale or foreign');
});

function sessionFixture(stale=false){
  let frozen=stale;
  let identity={...currentDocument,timeOrigin:0};
  const listeners=new Map<string,unknown>();
  const goto=vi.fn<Page['goto']>().mockImplementation(url=>{
    if(url==='about:blank')return Promise.resolve(null);
    identity={url,timeOrigin:frozen&&identity.timeOrigin>0?identity.timeOrigin:identity.timeOrigin+1,
      slug:frozen&&identity.timeOrigin>0?identity.slug:new URL(url).searchParams.get('chunk')??''};
    return Promise.resolve(null);
  });
  const evaluate=vi.fn<Page['evaluate']>().mockImplementation(fn=>{
    const state={document:identity,fatal:[],empty:false,ready:true,readyIds:[`${identity.slug}/actual`]};
    if(fn===explorerState)return Promise.resolve(state);
    if(fn===explorerCapture)return Promise.resolve({before:state,cards:[{id:`${identity.slug}/actual`,ready:true,pixels:100,darkShare:.2}],after:state});
    if(fn===explorerDiagnostics)return Promise.resolve({...diagnostics,document:identity});
    return Promise.resolve([{id:`${identity.slug}/actual`,ready:true,pixels:100,darkShare:.2}]);
  });
  const page:Page=legacyDouble<Page>({evaluate,goto,on:(event:string,listener:unknown)=>{listeners.set(event,listener);return page;},
    screenshot:vi.fn<Page['screenshot']>().mockRejectedValue(new Error('No capture in the bounded fixture'))});
  const close=vi.fn<BrowserContext['close']>().mockResolvedValue(undefined);
  const newPage=vi.fn<BrowserContext['newPage']>().mockResolvedValue({...page});
  const route=vi.fn<BrowserContext['route']>();
  const disposable={dispose:()=>Promise.resolve(),[Symbol.asyncDispose]:()=>Promise.resolve()};
  const {storage,send}=storageFixture();
  const newCDPSession=vi.fn<BrowserContext['newCDPSession']>().mockResolvedValue({...storage});
  const context=legacyDouble<BrowserContext>({newPage,route,close,newCDPSession,addInitScript:vi.fn<BrowserContext['addInitScript']>().mockResolvedValue(disposable)});
  const newContext=vi.fn<Browser['newContext']>().mockResolvedValue({...context});
  return {browser:legacyDouble<Browser>({newContext}),context:{...context},newContext,newPage,route,close,listeners,send,goto,evaluate,freezeDocument:()=>{frozen=true;}};
}

test('native context retirement bounds each group while every catalogue still draws',async()=>{
  mkdirSync('tmp/sp-x9-explorer',{recursive:true});const out=mkdtempSync('tmp/sp-x9-explorer/context-groups-');
  const f=sessionFixture(),session=await openExplorerSession(f.browser,'https://test.example/');
  try{
    const cases=['first','second','third','fourth','fifth'];
    for(const [index,slug]of cases.entries()){
      await session.sweep(slug,out);
      const result:unknown=JSON.parse(readFileSync(`${out}/${slug}.json`,'utf8'));
      expect(result).toMatchObject({slug,session:{generation:index<4?1:2,catalogue:index%4+1,maxCatalogues:4},
        cards:[{id:`${slug}/actual`,ready:true,pixels:100}],failures:[]});
    }
    expect(f.newContext).toHaveBeenCalledTimes(2);expect(f.newPage).toHaveBeenCalledTimes(2);
    expect(f.close).toHaveBeenCalledOnce();expect(f.send).toHaveBeenCalledTimes(5);expect(f.route).not.toHaveBeenCalled();
    expect(f.close.mock.invocationCallOrder[0]).toBeLessThan(f.newContext.mock.invocationCallOrder[1]??0);
  }finally{await session.close();rmSync(out,{recursive:true,force:true});}
  expect(f.close).toHaveBeenCalledTimes(2);
});

test('retirement keeps both earlier HTTP faults and prior document identity authoritative',async()=>{
  for(const mode of ['http','document']){
    mkdirSync('tmp/sp-x9-explorer',{recursive:true});const out=mkdtempSync('tmp/sp-x9-explorer/retired-fault-');
    const f=sessionFixture(),session=await openExplorerSession(f.browser,'https://test.example/');
    try{
      for(const slug of ['first','second','third','fourth'])await session.sweep(slug,out);
      if(mode==='document')f.freezeDocument();
      else{
        const response=f.listeners.get('response');if(typeof response!=='function')throw new Error('Missing HTTP observer');
        f.close.mockImplementationOnce(()=>{Reflect.apply(response,undefined,[{status:()=>500,url:()=> 'https://test.example/late.bin'}]);return Promise.resolve();});
      }
      await expect(session.sweep('fifth',out)).rejects.toThrow(mode==='http'?'HTTP 500':'stale or foreign');
      expect(f.newContext).toHaveBeenCalledTimes(2);
    }finally{await session.close();rmSync(out,{recursive:true,force:true});}
  }
});

test('failed context retirement stops replacement and never retries a catalogue',async()=>{
  mkdirSync('tmp/sp-x9-explorer',{recursive:true});const out=mkdtempSync('tmp/sp-x9-explorer/retire-refusal-');
  const f=sessionFixture(),session=await openExplorerSession(f.browser,'https://test.example/');
  try{
    for(const slug of ['first','second','third','fourth'])await session.sweep(slug,out);
    f.close.mockRejectedValueOnce(new Error('Native context retirement refused'));
    await expect(session.sweep('fifth',out)).rejects.toThrow('Native context retirement refused');
    await expect(session.sweep('sixth',out)).rejects.toThrow('session is closed');
    expect(f.newContext).toHaveBeenCalledOnce();expect(f.send).toHaveBeenCalledTimes(4);
  }finally{await session.close();rmSync(out,{recursive:true,force:true});}
});

test('closing during retirement cannot publish a replacement native context',async()=>{
  mkdirSync('tmp/sp-x9-explorer',{recursive:true});const out=mkdtempSync('tmp/sp-x9-explorer/retire-close-');
  const f=sessionFixture(),session=await openExplorerSession(f.browser,'https://test.example/');
  let finish:(()=>void)|undefined;
  try{
    for(const slug of ['first','second','third','fourth'])await session.sweep(slug,out);
    f.close.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const fifth=expect(session.sweep('fifth',out)).rejects.toThrow('session is closed');
    await session.close();if(finish===undefined)throw new Error('Missing retirement completion');finish();await fifth;
    expect(f.newContext).toHaveBeenCalledOnce();expect(f.send).toHaveBeenCalledTimes(4);
  }finally{finish?.();await session.close();rmSync(out,{recursive:true,force:true});}
});

test('stalled retirement consumes the original case budget and cannot open a late replacement',async()=>{
  mkdirSync('tmp/sp-x9-explorer',{recursive:true});const out=mkdtempSync('tmp/sp-x9-explorer/retire-stalled-');
  const f=sessionFixture(),session=await openExplorerSession(f.browser,'https://test.example/');
  let finish:(()=>void)|undefined;
  try{
    for(const slug of ['first','second','third','fourth'])await session.sweep(slug,out);
    f.close.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));vi.useFakeTimers();
    const fifth=expect(session.sweep('fifth',out)).rejects.toThrow('stalled for 180 seconds without progress');
    await vi.advanceTimersByTimeAsync(180001);await fifth;
    if(finish===undefined)throw new Error('Missing retirement completion');finish();
    await expect(session.sweep('sixth',out)).rejects.toThrow('session is closed');
    expect(f.newContext).toHaveBeenCalledOnce();expect(f.send).toHaveBeenCalledTimes(4);
  }finally{finish?.();vi.useRealTimers();await session.close();rmSync(out,{recursive:true,force:true});}
});

test('a context created after the progress timeout is retired without booting a catalogue',async()=>{
  mkdirSync('tmp/sp-x9-explorer',{recursive:true});const out=mkdtempSync('tmp/sp-x9-explorer/create-stalled-');
  const f=sessionFixture(),session=await openExplorerSession(f.browser,'https://test.example/');
  let finish:((context:BrowserContext)=>void)|undefined,start:(()=>void)|undefined;
  const entered=new Promise<void>(resolve=>{start=resolve;});
  let retired:(()=>void)|undefined;const cleanup=new Promise<void>(resolve=>{retired=resolve;});
  try{
    for(const slug of ['first','second','third','fourth'])await session.sweep(slug,out);
    f.newContext.mockImplementationOnce(()=>{start?.();return new Promise(resolve=>{finish=resolve;});});
    f.close.mockImplementation(()=>{if(f.close.mock.calls.length===2)retired?.();return Promise.resolve();});
    vi.useFakeTimers();const fifth=expect(session.sweep('fifth',out)).rejects.toThrow('stalled for 180 seconds without progress');
    await entered;await vi.advanceTimersByTimeAsync(180001);await fifth;
    if(finish===undefined)throw new Error('Missing context creation completion');finish(f.context);await cleanup;
    expect(f.send).toHaveBeenCalledTimes(4);
    await expect(session.sweep('sixth',out)).rejects.toThrow('session is closed');
  }finally{finish?.(f.context);vi.useRealTimers();await session.close();rmSync(out,{recursive:true,force:true});}
});

test('retirement time is not added back to the following renderer read budget',async()=>{
  mkdirSync('tmp/sp-x9-explorer',{recursive:true});const out=mkdtempSync('tmp/sp-x9-explorer/retire-charged-');
  const f=sessionFixture(),session=await openExplorerSession(f.browser,'https://test.example/');
  try{
    for(const slug of ['first','second','third','fourth'])await session.sweep(slug,out);
    f.close.mockImplementationOnce(()=>new Promise(resolve=>{setTimeout(resolve,120000);}));
    f.evaluate.mockImplementationOnce(()=>new Promise(resolve=>{setTimeout(()=>{resolve(undefined);},70000);}));
    vi.useFakeTimers();const fifth=expect(session.sweep('fifth',out)).rejects.toThrow('stalled for 180 seconds without progress');
    await vi.advanceTimersByTimeAsync(180001);await fifth;
    const result:unknown=JSON.parse(readFileSync(`${out}/fifth-failure.json`,'utf8'));
    expect(result).toMatchObject({elapsedMs:180000,hangMs:180000,session:{generation:2,catalogue:1}});
  }finally{vi.useRealTimers();await session.close();rmSync(out,{recursive:true,force:true});}
});

test('one context and page retain native caches while every catalogue has new document and pixel checks',async()=>{
  mkdirSync('tmp/sp-x9-explorer',{recursive:true});const out=mkdtempSync('tmp/sp-x9-explorer/reused-');
  const f=sessionFixture(),session=await openExplorerSession(f.browser,'https://test.example/');
  try{
    for(const slug of ['first','second','first']){
      await session.sweep(slug,out);
      const result:unknown=JSON.parse(readFileSync(`${out}/${slug}.json`,'utf8'));
      expect(result).toMatchObject({slug,document:{slug},cards:[{id:`${slug}/actual`,pixels:100,darkShare:.2}],failures:[]});
    }
    expect(f.newContext).toHaveBeenCalledOnce();expect(f.newPage).toHaveBeenCalledOnce();
    expect(f.send).toHaveBeenCalledTimes(3);
    expect(f.goto.mock.calls.map(([url])=>url)).toEqual([
      'about:blank',expect.stringContaining('chunk=first'),
      'about:blank',expect.stringContaining('chunk=second'),
      'about:blank',expect.stringContaining('chunk=first'),
    ]);
    for(const [method,params] of f.send.mock.calls){
      expect(method).toBe('Storage.clearDataForOrigin');
      expect(params).toMatchObject({origin:'https://test.example'});
      if(params===undefined || !('storageTypes' in params) || typeof params.storageTypes!=='string')throw new Error('Missing store selection');
      expect(params.storageTypes.split(',')).toEqual(expect.arrayContaining(['cache_storage','indexeddb','local_storage','service_workers']));
      expect(params.storageTypes.split(',')).not.toContain('all');
      expect(params.storageTypes.split(',')).not.toContain('shader_cache');
    }
    expect(f.route).not.toHaveBeenCalled();expect(f.close).not.toHaveBeenCalled();
  }finally{await session.close();rmSync(out,{recursive:true,force:true});}
  expect(f.close).toHaveBeenCalledOnce();
});

test('origin cleanup failure refuses before another world can boot',async()=>{
  mkdirSync('tmp/sp-x9-explorer',{recursive:true});const out=mkdtempSync('tmp/sp-x9-explorer/storage-refusal-');
  const f=sessionFixture(),session=await openExplorerSession(f.browser,'https://test.example/');
  f.send.mockRejectedValue(new Error('Storage deletion failed'));
  try{
    await expect(session.sweep('first',out)).rejects.toThrow('Storage deletion failed');
    expect(f.goto).toHaveBeenCalledExactlyOnceWith('about:blank',{waitUntil:'domcontentloaded',timeout:30000});
  }finally{await session.close();rmSync(out,{recursive:true,force:true});}
});

test('stalled origin cleanup stays inside the original no-progress guard',async()=>{
  mkdirSync('tmp/sp-x9-explorer',{recursive:true});const out=mkdtempSync('tmp/sp-x9-explorer/storage-stalled-');
  const f=sessionFixture(),session=await openExplorerSession(f.browser,'https://test.example/');
  f.send.mockImplementation(()=>new Promise(()=>{ /* No protocol completion. */ }));
  vi.useFakeTimers();
  try{
    const refusal=expect(session.sweep('first',out)).rejects.toThrow('stalled for 180 seconds without progress');
    await vi.advanceTimersByTimeAsync(180001);await refusal;
    expect(f.goto).toHaveBeenCalledExactlyOnceWith('about:blank',{waitUntil:'domcontentloaded',timeout:30000});
  }finally{vi.useRealTimers();await session.close();rmSync(out,{recursive:true,force:true});}
});

test('previous ready cards cannot pass the next reused catalogue',async()=>{
  mkdirSync('tmp/sp-x9-explorer',{recursive:true});const out=mkdtempSync('tmp/sp-x9-explorer/old-document-');
  const f=sessionFixture(true),session=await openExplorerSession(f.browser,'https://test.example/');
  try{
    await session.sweep('first',out);
    await expect(session.sweep('second',out)).rejects.toThrow('stale or foreign');
  }finally{await session.close();rmSync(out,{recursive:true,force:true});}
});

test('a late HTTP error from an earlier catalogue remains fatal to the reused session',async()=>{
  mkdirSync('tmp/sp-x9-explorer',{recursive:true});const out=mkdtempSync('tmp/sp-x9-explorer/late-http-');
  const f=sessionFixture(),session=await openExplorerSession(f.browser,'https://test.example/');
  try{
    await session.sweep('first',out);
    const response=f.listeners.get('response');if(typeof response!=='function')throw new Error('Missing HTTP observer');
    Reflect.apply(response,undefined,[{status:()=>500,url:()=> 'https://test.example/failed.bin'}]);
    await expect(session.sweep('second',out)).rejects.toThrow('HTTP 500');
  }finally{await session.close();rmSync(out,{recursive:true,force:true});}
});


test('pixel capture keeps roster witnesses in the same task before a queued invalidation',async()=>{
  document.body.innerHTML='<div class="ws-x show" data-mode="model"><div class="ws-x-grid"><button class="ws-x-model" data-id="shared/model"><canvas width="4" height="1"></canvas></button></div></div>';
  const canvas=document.querySelector('canvas');if(canvas===null)throw new Error('Missing canvas');
  const context=legacyDouble<CanvasRenderingContext2D>({getImageData:()=>{
    queueMicrotask(()=>canvas.remove());
    return {data:Uint8ClampedArray.from([64,64,64,255]),width:1,height:1,colorSpace:'srgb'};
  }});
  const getter=vi.spyOn(canvas,'getContext').mockReturnValue(context);
  try{
    const captured=explorerCapture();
    expect(captured.before.ready).toBe(true);expect(captured.after.ready).toBe(true);
    expect(captured.after.readyIds).toEqual(captured.cards.map(card=>card.id));
    expect(explorerFailures(captured.cards)).toEqual([]);
    await Promise.resolve();expect(explorerState().ready).toBe(false);
  }finally{getter.mockRestore();document.body.replaceChildren();}
});

test('a changed final roster still refuses and retains its exact witness',async()=>{
  mkdirSync('tmp/sp-x9-explorer',{recursive:true});const out=mkdtempSync('tmp/sp-x9-explorer/changed-capture-');
  const state={document:currentDocument,fatal:[],empty:false,ready:true,readyIds:['old']};
  const card={id:'old',ready:true,pixels:100,darkShare:.2};
  const evaluate=vi.fn<Page['evaluate']>().mockResolvedValueOnce(state)
    .mockResolvedValueOnce({before:state,cards:[card],after:{...state,readyIds:['replacement']}}).mockResolvedValue(diagnostics);
  const {browser}=fixtureBrowser(evaluate);
  try{
    await expect(sweepExplorer(browser,'https://test.example/','fixture',out)).rejects.toThrow('catalogue changed during pixel validation');
    const receipt:unknown=JSON.parse(readFileSync(`${out}/fixture.json`,'utf8'));
    expect(receipt).toMatchObject({captureBefore:{readyIds:['old']},captureAfter:{readyIds:['replacement']}});
  }finally{rmSync(out,{recursive:true,force:true});}
});


test('the two serial Explorer groups exactly partition every freshly discovered route',()=>{
  for(const extra of [[],[{slug:'future-route',status:'hidden',legacy:false,shardSelect:false}],
    [{slug:'future-public',status:'live',legacy:false},{slug:'future-dev',status:'experimental',legacy:false}]]){
    const cases=explorerCases([...catalogue,...extra]);
    const a=explorerPartition(cases,'explorer-a'),b=explorerPartition(cases,'explorer-b');
    expect(a.flatMap((slug,index)=>b[index]===undefined?[slug]:[slug,b[index]])).toEqual(cases);
    expect(new Set([...a,...b]).size).toBe(cases.length);
    expect(a.some(slug=>b.includes(slug))).toBe(false);
    expect(explorerPartition(cases)).toEqual(cases);
    expect(explorerPartition(cases,'all')).not.toBe(cases);
  }
  expect(explorerPartition([],'explorer-a')).toEqual([]);
  expect(explorerPartition(['only'],'explorer-b')).toEqual([]);
  for(const group of ['explorer','foreign','explorer-c',''])expect(()=>explorerPartition([],group)).toThrow('group');
  expect(()=>explorerPartition(['duplicate','duplicate'],'explorer-a')).toThrow('inventory');
  expect(()=>explorerPartition([''],'explorer-b')).toThrow('inventory');
});
