// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Verify the real failure receipt in owned scratch.
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths remain under repository tmp.
import {resolve,join} from 'node:path';
import type {Browser} from 'playwright';
import {expect,test} from 'vitest';
import {assertNineLoad,NINE_READY_CAP_MS,NINE_SETTLE_CAP_MS,NINE_SETTLE_MS,NINE_STALL_MS,readNineState,waitNineReady,waitNineSettled} from '../src/scripts/loading-flow/nine-load.mjs';

/** A clock that only moves when the wait sleeps. */
function fakeClock() {
  let at=0;
  return {now:()=>at,sleep:(ms:number)=>{at+=ms;return Promise.resolve();},log:()=>undefined};
}
const state=(done:number,frames=0,open=['stage:firstFrame'])=>({error:null,ready:false,frames,done,open});

test.each([false,true])('Nine readiness failure retains its cause and timeline (terminal screen: %s)',async terminal=>{
  const out=mkdtempSync(resolve('tmp/nine-load-test-'));
  const message='Tile fence stalled: 1 tile inside it made no progress';
  const timeline=[{operation:'stage:props',realm:'page',start:100,end:null}];
  if(terminal){
    document.body.innerHTML=`<section class="ws-load-error">
      <h1>Nine failed to load</h1><p>Build at readyFrame</p><p>${message}</p>
    </section>`;
  }
  let closed=false,detached=false;
  const profile={send:()=>Promise.resolve(),detach:()=>{detached=true;return Promise.resolve();}};
  const profilingContext={browser:()=>({browserType:()=>({name:()=>'chromium'})}),newCDPSession:()=>Promise.resolve(profile)};
  // The page's own read runs here against happy-dom's document; every other evaluate returns the boot timeline.
  // J522: the load enters Nine alone (a one-cell world routed into `/`), and its address names no zone
  const opened:string[]=[],routed:string[]=[];
  const page={context:()=>profilingContext,on:()=>undefined,goto:(url:string)=>{opened.push(url);return Promise.resolve();},
    route:(url:string)=>{routed.push(url);return Promise.resolve();},unroute:()=>Promise.resolve(),
    evaluate:(read:()=>unknown)=>Promise.resolve(read===readNineState?read():timeline)};
  const context={addInitScript:()=>Promise.resolve(),newPage:()=>Promise.resolve(page),
    close:()=>{closed=true;return Promise.resolve();}};
  const browser={newContext:()=>Promise.resolve(context)} as unknown as Browser;
  try{
    const load=assertNineLoad(browser,'http://127.0.0.1:1234',out,fakeClock());
    await expect(load).rejects.toThrow(terminal?message:'Nine boot made no progress for 150 s');
    const receipt=JSON.parse(readFileSync(join(out,'load-error.json'),'utf8')) as {error:string;timeline:unknown;stallMs:number;capMs:number;last:unknown};
    expect(receipt).toMatchObject({error:expect.stringContaining(terminal?message:'no progress'),timeline,stallMs:NINE_STALL_MS,capMs:NINE_READY_CAP_MS});
    // a stall names where the boot stood, not null (run 44847945386's receipt had no timeline at all)
    if(!terminal)expect(receipt.last).toEqual({error:null,ready:false,frames:0,done:0,open:[]});
    expect(closed&&detached).toBe(true);
    expect(opened).toEqual(['http://127.0.0.1:1234/?skipintro=1&tier=phone&touch=1&mute=1&nolock=1&sw=0']);
    expect(routed).toEqual(opened);
  }finally{document.body.replaceChildren();rmSync(out,{recursive:true,force:true});}
});

test('engine red 44847945386: a slow boot that keeps moving passes 235 s; a stalled or endless one fails, naming its stage', async()=>{
  // A hosted SwiftShader boot finishing a stage every 40 s is ready at 300 s, past the old flat 235 s.
  let clock=fakeClock(),reads=0;
  const moving=()=>{reads++;const at=clock.now();return Promise.resolve(at>=300_000?{...state(99,3),ready:true}:state(Math.floor(at/40_000)));};
  await expect(waitNineReady(moving,clock)).resolves.toMatchObject({readinessMs:300_000});
  expect(reads).toBeGreaterThan(50);

  // No stage finished and no frame drawn for 150 s: hung, wherever it is.
  clock=fakeClock();
  const stuck=()=>Promise.resolve(clock.now()<20_000?state(clock.now()>=10_000?5:4):state(5));
  const hung=waitNineReady(stuck,clock);
  await expect(hung).rejects.toThrow('Nine boot made no progress for 150 s (stage stage:firstFrame, 5 boot steps done, 0 frames)');
  await expect(hung).rejects.toMatchObject({nine:{readinessMs:160_000}});

  // A page too busy to answer is not progress either.
  clock=fakeClock();
  await expect(waitNineReady(()=>Promise.resolve(null),clock)).rejects.toThrow('no progress for 150 s (no answer from the page)');

  // Moving but never ready: the cap ends it.
  clock=fakeClock();
  await expect(waitNineReady(()=>Promise.resolve(state(clock.now())),clock)).rejects.toThrow(`Nine boot not ready after ${NINE_READY_CAP_MS/1000} s`);

  // A terminal load screen ends the wait at once with its message.
  clock=fakeClock();
  await expect(waitNineReady(()=>Promise.resolve({...state(1),error:'Tile fence stalled'}),clock)).rejects.toThrow('Nine boot failed: Tile fence stalled');
  expect(clock.now()).toBe(0);
});

test('QA 11-25 row 115: the boot memory read waits for the after-control build to settle, bounded', async()=>{
  // Metal's after-control build: CPU geometry climbs and falls for about 6 s, then holds; the read comes 3 s into the hold
  let clock=fakeClock();
  const ramp=[21,24,28,33,42,37,29,29,26,26,20,15,9,8,7,6.4];
  const climbing=()=>Promise.resolve(ramp[Math.min(Math.floor(clock.now()/500),ramp.length-1)]??null);
  await expect(waitNineSettled(climbing,clock)).resolves.toEqual({settled:true,waitedMs:(ramp.length-1)*500+NINE_SETTLE_MS,retained:6.4});
  // already still (hosted SwiftShader before its slow build): one window
  clock=fakeClock();
  await expect(waitNineSettled(()=>Promise.resolve(6.8),clock)).resolves.toEqual({settled:true,waitedMs:NINE_SETTLE_MS,retained:6.8});
  // a page that never holds still, or never answers, is read at the cap and says so
  clock=fakeClock();
  await expect(waitNineSettled(()=>Promise.resolve(clock.now()),clock)).resolves.toMatchObject({settled:false,waitedMs:NINE_SETTLE_CAP_MS});
  clock=fakeClock();
  await expect(waitNineSettled(()=>Promise.resolve(null),clock)).resolves.toEqual({settled:false,waitedMs:NINE_SETTLE_CAP_MS,retained:null});
});
