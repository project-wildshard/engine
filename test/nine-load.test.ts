// oxlint-disable-next-line import/no-nodejs-modules -- Verify the real failure receipt in owned scratch.
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths remain under repository tmp.
import {resolve,join} from 'node:path';
import type {Browser} from 'playwright';
import {expect,test} from 'vitest';
import {assertNineLoad,NINE_READY_TIMEOUT_MS} from '../scripts/loading-flow/nine-load.mjs';

test('Nine readiness failure retains the boot timeline, rethrows and closes its context',async()=>{
  const out=mkdtempSync(resolve('tmp/nine-load-test-'));
  const failure=new Error('readiness did not reach real control');
  const timeline=[{operation:'stage:props',realm:'page',start:100,end:null}];
  let closed=false,detached=false,timeout=0;
  const profile={send:()=>Promise.resolve(),detach:()=>{detached=true;return Promise.resolve();}};
  const profilingContext={browser:()=>({browserType:()=>({name:()=>'chromium'})}),newCDPSession:()=>Promise.resolve(profile)};
  const page={context:()=>profilingContext,on:()=>undefined,goto:()=>Promise.resolve(),
    waitForFunction:(_fn:unknown,_arg:unknown,options:{timeout:number})=>{timeout=options.timeout;return Promise.reject(failure);},
    evaluate:()=>Promise.resolve(timeline)};
  const context={addInitScript:()=>Promise.resolve(),newPage:()=>Promise.resolve(page),
    close:()=>{closed=true;return Promise.resolve();}};
  const browser={newContext:()=>Promise.resolve(context)} as unknown as Browser;
  try{
    await expect(assertNineLoad(browser,'http://127.0.0.1:1234',out)).rejects.toBe(failure);
    const receipt=JSON.parse(readFileSync(join(out,'load-error.json'),'utf8')) as {error:string;timeline:unknown;readinessTimeoutMs:number};
    expect(receipt).toMatchObject({error:failure.message,timeline,readinessTimeoutMs:NINE_READY_TIMEOUT_MS});
    expect(timeout).toBe(NINE_READY_TIMEOUT_MS);
    expect(closed&&detached).toBe(true);
  }finally{rmSync(out,{recursive:true,force:true});}
});
