// oxlint-disable promise/prefer-await-to-callbacks -- Browser events and the requestAnimationFrame cap require browser callback APIs.
// Manual MMO-PLAN GO1 proof: staging only, capped at 30 fps; both browsers close on every outcome.
// node scripts/mmo-seat-proof.mjs chromium|webkit tmp/<lane>/seat
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium,webkit} from "./browser-playwright.mjs";
import {KEYCHAIN_ARGS} from './chromium-keychain.mjs';
import {saveFixture} from './debug-settings.mjs';
import {guardStagingSockets,playerNameSource} from './staging-proof-lines.mjs';
import {FLOOR_GRID_ENTER} from './frame-floor-navigation.mjs';

const engine=process.argv[2],out=process.argv[3];
assert.ok(engine==='chromium'||engine==='webkit');assert.ok(out?.startsWith('tmp/'));mkdirSync(out,{recursive:true});
const signed=await(await fetch('https://packs.wildshard.io/releases/staging.json')).json(),release=JSON.parse(signed.body);
assert.equal(release.channel,'staging');assert.equal(release.socket,'wss://rooms-staging.wildshard.io');
const version=await(await fetch('https://staging.wildshard.io/version.json')).json();assert.equal(version.build,release.engineBuild);
const browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,args:engine==='webkit'?[]:[...KEYCHAIN_ARGS,'--use-angle=metal']});
/** @type {string[]} */ const faults=[];
/** @type {{engine:string,build:string,serial:number,coldTitle?:boolean,visibleAfterPlay?:boolean,leaveMs?:number,errors?:string[]}} */
const report={engine,build:version.build,serial:release.serial};
try {
 const page=async()=>{const c=await browser.newContext({viewport:{width:960,height:600}});await saveFixture(c,{scope:'device',key:'devMode',data:true});await c.addInitScript(guardStagingSockets,release.socket);await c.addInitScript(()=>{window.requestAnimationFrame=callback=>window.setTimeout(()=>callback(performance.now()),1000/30);window.cancelAnimationFrame=id=>window.clearTimeout(id);});const p=await c.newPage();p.on('pageerror',e=>faults.push(e.message));return p;};
 const a=await page(),b=await page(),tag=Date.now().toString(36).slice(-5),nameA=`Seat ${tag} A`,nameB=`Seat ${tag} B`;
 await a.goto('https://staging.wildshard.io/?chunk=driftwood-isle&fps=30&mute=1&nolock=1');
 await a.locator('.ws-main-select').waitFor({timeout:45000});
 report.coldTitle=await a.evaluate(()=>!window.__workerClient&&!window.__wildshard?.world);
 assert.equal(report.coldTitle,true);console.log('PASS cold title has no world or seat');
 await b.goto('https://staging.wildshard.io/?chunk=driftwood-isle&fps=30&mute=1&nolock=1&skipintro=1');
 /** @param {import('playwright').Page} p @param {string} name */
 const named=async(p,name)=>{await p.locator('#ws-name-box input').waitFor({timeout:90000});await p.locator('#ws-name-box input').fill(name);await p.locator('#ws-name-box button[type=submit]').click();};
 /** @param {import('playwright').Page} p @param {string} name @param {boolean} [alreadyNamed] */
 const enter=async(p,name,alreadyNamed=false)=>{if(!alreadyNamed)await named(p,name);await p.waitForFunction(()=>window.__workerClient&&window.__wildshard?.world?.player,undefined,{timeout:90000});await p.evaluate(FLOOR_GRID_ENTER);await p.waitForFunction(()=>(window.__workerClient?.().frames??0)>30,undefined,{timeout:30000});};
 await enter(b,nameB);console.log('observer seated');
 const before=await b.evaluate(()=>window.__onlinePlayers?.()??[]);assert.equal(before.some(r=>new RegExp(playerNameSource(nameA),'u').test(r.name)),false);
 await a.locator('.ws-main-select').click();await named(a,nameA);await a.locator('.ws-menu-play').click();await enter(a,nameA,true);console.log('subject seated after Play');
 await b.waitForFunction(source=>window.__onlinePlayers?.().some(r=>new RegExp(source,'u').test(r.name)),playerNameSource(nameA),{timeout:15000});
 report.visibleAfterPlay=true;
 await a.keyboard.press('Escape');await a.getByRole('button',{name:/exit to main/iu}).click();
 const start=Date.now();await b.waitForFunction(source=>!window.__onlinePlayers?.().some(r=>new RegExp(source,'u').test(r.name)),playerNameSource(nameA),{timeout:5000});
 report.leaveMs=Date.now()-start;report.errors=faults;assert.deepEqual(faults,[]);console.log(JSON.stringify(report));
 writeFileSync(join(out,`seat-${engine}.json`),JSON.stringify(report,null,2));
} finally {await browser.close();}
