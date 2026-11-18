// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Verify the real failure receipt in owned scratch.
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths remain under repository tmp.
import {resolve,join} from 'node:path';
import type {Browser} from 'playwright';
import {expect,test} from 'vitest';
import {assertNineLoad,NINE_READY_TIMEOUT_MS} from '../scripts/loading-flow/nine-load.mjs';

test.each([false,true])('Nine readiness failure retains its cause and timeline (terminal screen: %s)',async terminal=>{
  const out=mkdtempSync(resolve('tmp/nine-load-test-'));
  const failure=new Error('readiness did not reach real control');
  const message='Tile fence stalled: 1 tile inside it made no progress';
  const timeline=[{operation:'stage:props',realm:'page',start:100,end:null}];
  if(terminal){
    document.body.innerHTML=`<section class="ws-load-error">
      <h1>Nine failed to load</h1><p>Build at readyFrame</p><p>${message}</p>
    </section>`;
  }
  let closed=false,detached=false,timeout=0;
  const profile={send:()=>Promise.resolve(),detach:()=>{detached=true;return Promise.resolve();}};
  const profilingContext={browser:()=>({browserType:()=>({name:()=>'chromium'})}),newCDPSession:()=>Promise.resolve(profile)};
  const page={context:()=>profilingContext,on:()=>undefined,goto:()=>Promise.resolve(),
    waitForFunction:(read:()=>unknown,_arg:unknown,options:{timeout:number})=>{
      timeout=options.timeout;
      const result=read();
      if(!result)return Promise.reject(failure);
      return Promise.resolve({jsonValue:()=>Promise.resolve(result),dispose:()=>Promise.resolve()});
    },
    evaluate:()=>Promise.resolve(timeline)};
  const context={addInitScript:()=>Promise.resolve(),newPage:()=>Promise.resolve(page),
    close:()=>{closed=true;return Promise.resolve();}};
  const browser={newContext:()=>Promise.resolve(context)} as unknown as Browser;
  try{
    const load=assertNineLoad(browser,'http://127.0.0.1:1234',out);
    if(terminal)await expect(load).rejects.toThrow(message);
    else await expect(load).rejects.toBe(failure);
    const receipt=JSON.parse(readFileSync(join(out,'load-error.json'),'utf8')) as {error:string;timeline:unknown;readinessTimeoutMs:number};
    expect(receipt).toMatchObject({error:terminal?expect.stringContaining(message):failure.message,timeline,readinessTimeoutMs:NINE_READY_TIMEOUT_MS});
    expect(timeout).toBe(NINE_READY_TIMEOUT_MS);
    expect(closed&&detached).toBe(true);
  }finally{document.body.replaceChildren();rmSync(out,{recursive:true,force:true});}
});
