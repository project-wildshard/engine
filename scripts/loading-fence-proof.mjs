#!/usr/bin/env node
// Manual native-WebGL lifecycle counterexamples, outside hooks. Run through browser-lane.sh.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {transform} from 'esbuild';
import {chromium,webkit,devices} from 'playwright';
import {serve} from './parity/serve.mjs';
import {saveFixture} from './debug-settings.mjs';

const compiled=await transform(readFileSync('src/client/engine/render/fencedUnits.ts','utf8'),
  {loader:'ts',format:'iife',globalName:'__fencedProbe'});
const preview=await serve(process.cwd(),'',true);
try{for(const name of ['chromium','webkit']){
  const engine=name==='chromium'?chromium:webkit;
  const browser=await engine.launch({headless:true,...(name==='chromium'?{args:['--mute-audio']}: {})});
  try{
    const context=await browser.newContext({...devices['iPhone 16 Pro'],deviceScaleFactor:2});
    await saveFixture(context,{scope:'device',key:'devMode',data:true});
    const page=await context.newPage();
    await page.goto(`${preview.url}/?chunk=_template&tier=phone&mute=1&nolock=1&sw=0`);
    await page.waitForFunction(()=>Reflect.get(window,'__wildshard')?.world?.game!==undefined,null,{timeout:90000});
    await page.addScriptTag({content:compiled.code});
    const result=await page.evaluate(`(async()=>{
      const out=[];
      for(const kind of ['normal','dispose','lost-before','lost-inflight','wait-failed','callback']){
        const owner=window.__wildshard.world.game.engineScope.child('codex.native-fence-'+kind);
        const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2');
        if(!gl)throw new Error('Native WebGL2 unavailable');
        const lose=gl.getExtension('WEBGL_lose_context');if(!lose)throw new Error('Native context-loss extension unavailable');
        const units=new window.__fencedProbe.FencedUnits(gl,owner,3);
        let completed=0,outcome='pending';
        const lost=()=>new Promise(resolve=>{canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();resolve();},{once:true});lose.loseContext();});
        try{
          if(kind==='lost-before')await lost();
          const live=[];const original=gl.fenceSync.bind(gl);
          if(kind==='wait-failed')gl.fenceSync=(...args)=>{const sync=original(...args);live.push(sync);return sync;};
          await units.submit(()=>{if(kind==='callback')throw new Error('native callback failure');completed++;});
          if(kind==='lost-inflight'||kind==='callback')await units.submit(()=>{completed++;});
          if(kind==='lost-inflight')await lost();
          if(kind==='wait-failed')for(const sync of live)gl.deleteSync(sync);
          const work=units.drain().then(()=>{outcome='resolved';},error=>{outcome=error.reason??error.message;});
          if(kind==='dispose')owner.dispose();
          let deadline;try{await Promise.race([work,new Promise((_,reject)=>{deadline=setTimeout(()=>reject(new Error('native wait did not settle')),1000);})]);}finally{clearTimeout(deadline);}
        }catch(error){outcome=error.reason??error.message;}
        finally{units.dispose();owner.dispose();if(!gl.isContextLost())lose.loseContext();}
        out.push({kind,outcome,completed,pending:units.pending,...units.census});
      }
      return out;
    })()`);
    for(const row of result){
      assert.equal(row.pending,0);assert.equal(row.created,row.deleted);
      if(row.kind==='normal'){assert.equal(row.outcome,'resolved');assert.equal(row.completed,1);}
      else{const expected={dispose:'disposed','lost-before':'context-lost','lost-inflight':'context-lost','wait-failed':'wait-failed',callback:'native callback failure'};assert.equal(row.outcome,Reflect.get(expected,row.kind));assert.equal(row.completed,0);}
      if(row.kind!=='normal'&&row.kind!=='callback')assert.equal(row.credited,0);
    }
    console.log(`${name}: ${JSON.stringify(result)}`);
    await context.close();
  }finally{await browser.close();}
}}finally{preview.close();}
