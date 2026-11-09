// Manual real-play milestones; never a hook or unit-test entry.
import assert from 'node:assert/strict';
import { chromium,webkit,devices } from 'playwright';
import { serve } from './parity/serve.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';
/** @param {string} name @param {string} fallback */
const arg=(name,fallback)=>process.argv.find(value=>value.startsWith(`--${name}=`))?.slice(name.length+3)??fallback;
const flow=arg('only','perks'), samples=Number(arg('samples','3')), red=process.argv.includes('--expect-red');
const preview=await serve(arg('root',process.cwd()),'',true);
try {
  const {run}=await import(`./split-repair-${flow}.mjs`);
  const pick=arg('browser','both');
  if(!['both','chromium','webkit'].includes(pick))throw new Error('Unknown proof browser');
  for(const name of ['chromium','webkit'].filter(engineName=>pick==='both'||pick===engineName)) {
    for(let sample=0;sample<samples;sample++) {
    const browser=await (name==='chromium'?chromium:webkit).launch(name==='chromium'?{args:[...KEYCHAIN_ARGS, '--mute-audio','--use-angle=metal','--ignore-gpu-blocklist']}:{});
    try {
      const result=await run(browser,devices['iPhone 16 Pro'],preview.url);
      console.log(JSON.stringify({flow,browser:name,sample:sample+1,...result}));
      assert.equal(result.ok,!red,red?'regression was not reproduced':'real play failed');
    } finally {await browser.close();}
    }
  }
} finally {preview.close();}
