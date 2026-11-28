import {expect,test} from 'vitest';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {grantLoopback} from '../src/scripts/loopback-grant.mjs';
import {enterZone} from '../src/scripts/zone-entry.mjs';

// Meta QA 11-26 rows 75 and 80: headless Chromium 158 denies a page's read of another loopback port when the page document came
// from a Playwright route (no address, so "public"), never when the rig or a preview server served it. Row 75's walk stalled on
// enterZone's routed one-cell page; row 80's eleven rig harnesses open the rig's own page and read it fine (seat-hold-proof on
// Chromium played with no grant). So the grant lives where the routed page is made, through one helper.

/** @typedef {[string[], {origin: string}]} Granted */
/** @param {string | null} name @param {Granted[]} grants @param {string[]} [log] */
const contextOf=(name,grants,log=[])=>({
  browser:()=>name===null?null:{browserType:()=>({name:()=>name})},
  grantPermissions:async(/** @type {string[]} */ permissions,/** @type {{origin: string}} */ options)=>{log.push('grant');grants.push([permissions,options]);},
});

test('QA 11-26 row 80: grantLoopback grants Chromium (and a browserless persistent context), never WebKit or Firefox',async()=>{
  /** @type {Granted[]} */ const grants=[];
  await grantLoopback(contextOf('chromium',grants),'http://127.0.0.1:18798/?mute=1');
  await grantLoopback(contextOf(null,grants),'http://127.0.0.1:18799/');
  await grantLoopback(contextOf('webkit',grants),'http://127.0.0.1:18798/');
  await grantLoopback(contextOf('firefox',grants),'http://127.0.0.1:18798/');
  expect(grants).toEqual([[['local-network-access'],{origin:'http://127.0.0.1:18798'}],[['local-network-access'],{origin:'http://127.0.0.1:18799'}]]);
});

test('QA 11-26 row 80: enterZone grants a routed one-cell page loopback leave before its route, and a served page none',async()=>{
  const run=async(/** @type {boolean} */ alone)=>{
    /** @type {Granted[]} */ const grants=[];
    /** @type {string[]} */ const log=[];
    const context=contextOf('chromium',grants,log);
    const page={context:()=>context,url:()=>'about:blank',route:async()=>{log.push('route');},unroute:async()=>{log.push('unroute');},
      goto:async(/** @type {string} */ url)=>{log.push(`goto ${new URL(url).pathname}`);},evaluate:async()=>null};
    await enterZone(/** @type {never} */ (page),{zone:'nine-dragon-stack',base:'http://127.0.0.1:18798',alone});
    return {grants,log};
  };
  const routed=await run(true);
  expect(routed.log).toEqual(['grant','route','goto /','unroute']);
  expect(routed.grants).toEqual([[['local-network-access'],{origin:'http://127.0.0.1:18798'}]]);
  expect((await run(false)).grants,'the rig\'s own page is loopback already').toEqual([]);
});

const SOURCES=['src/scripts','src/test','test'];
/** @param {string} dir @returns {string[]} */
const walk=dir=>readdirSync(dir).flatMap(name=>{const path=join(dir,name);return statSync(path).isDirectory()?walk(path):/\.(mjs|ts)$/u.test(name)?[path]:[];});
const files=SOURCES.flatMap(walk).filter(path=>path!=='test/loopback-grant.test.mjs'&&path!=='src/scripts/loopback-grant.mjs');

test('QA 11-26 row 80: only loopback-grant.mjs names the local-network-access permission',()=>{
  const named=files.filter(path=>/grantPermissions\([^)]*local-network-access/u.test(readFileSync(path,'utf8')));
  expect(named,'grant loopback leave through src/scripts/loopback-grant.mjs grantLoopback').toEqual([]);
});

test('QA 11-26 row 80: every harness that serves a one-cell page by route grants it loopback leave',()=>{
  const routed=files.filter(path=>{const text=readFileSync(path,'utf8');return /\.fulfill\(/u.test(text)&&/oneCellPage\(/u.test(text);});
  expect(routed.length,'the scan still finds the routed one-cell pages').toBeGreaterThan(1);
  expect(routed.filter(path=>!readFileSync(path,'utf8').includes('await grantLoopback(')),'a routed page document counts as public to Chromium').toEqual([]);
});
