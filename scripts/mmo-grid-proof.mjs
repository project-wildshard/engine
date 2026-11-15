// oxlint-disable promise/prefer-await-to-callbacks -- Browser events, audio sources and the frame cap require browser callbacks.
// Manual MMO-PLAN GO8 proof: staging only, 30 fps, no physical phone.
// node scripts/mmo-grid-proof.mjs chromium|webkit tmp/<lane>/grid
import assert from 'node:assert/strict';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {chromium,webkit} from 'playwright';
import {KEYCHAIN_ARGS} from './chromium-keychain.mjs';
import {saveFixture} from './debug-settings.mjs';
import {guardStagingSockets,playerNameSource} from './staging-proof-lines.mjs';
import {FLOOR_GRID_ENTER} from './frame-floor-navigation.mjs';

/** Synthetic PCM only: headless proofs never open a real microphone. */
function proofMicrophone(){
 if(!navigator.mediaDevices)return;
 navigator.mediaDevices.getUserMedia=()=>{
  const audio=new AudioContext(),osc=audio.createOscillator(),gain=audio.createGain(),dest=audio.createMediaStreamDestination();
  Reflect.set(window,'__mmoAudio',{audio,osc,gain,dest});
  osc.connect(gain);gain.connect(dest);osc.start();gain.gain.value=.6;
  setInterval(()=>{gain.gain.value=gain.gain.value>0?0:.6;},600);
  return audio.resume().then(()=>dest.stream);
 };
}

const engine=process.argv[2],out=process.argv[3];
assert.ok(engine==='chromium'||engine==='webkit');assert.ok(out?.startsWith('tmp/'));mkdirSync(out,{recursive:true});
const signed=await(await fetch('https://packs.wildshard.io/releases/staging.json')).json(),release=JSON.parse(signed.body);
assert.equal(release.channel,'staging');assert.equal(release.socket,'wss://rooms-staging.wildshard.io');
const version=await(await fetch('https://staging.wildshard.io/version.json')).json();assert.equal(version.build,release.engineBuild);
const browser=await(engine==='webkit'?webkit:chromium).launch({headless:true,args:engine==='webkit'?[]:[...KEYCHAIN_ARGS,'--use-angle=metal']});
/** @type {string[]} */ const faults=[];
/** @type {{engine:string,build:string,serial:number,coldTitle?:boolean,visibleAfterPlay?:boolean,leaveMs?:number,errors?:string[],locations?:{select:{inside:string|null,level:string|undefined},infinite:{inside:string|null,level:string|undefined}},chat?:boolean,voiceBothWays?:boolean}} */
const report={engine,build:version.build,serial:release.serial};
try {
 const page=async()=>{const c=await browser.newContext({viewport:{width:960,height:600}});await c.grantPermissions(['microphone'],{origin:'https://staging.wildshard.io'});await saveFixture(c,{scope:'device',key:'devMode',data:true});await c.addInitScript(guardStagingSockets,release.socket);await c.addInitScript(proofMicrophone);await c.addInitScript(()=>{window.requestAnimationFrame=callback=>window.setTimeout(()=>callback(performance.now()),1000/30);window.cancelAnimationFrame=id=>window.clearTimeout(id);});const p=await c.newPage();p.on('pageerror',e=>faults.push(e.message));return p;};
 const a=await page(),b=await page(),tag=Date.now().toString(36).slice(-5),nameA=`Seat ${tag} A`,nameB=`Seat ${tag} B`;
 await a.goto('https://staging.wildshard.io/?chunk=driftwood-isle&fps=30&mute=1&nolock=1');
 await a.locator('.ws-main-select').waitFor({timeout:45000});
 report.coldTitle=await a.evaluate(()=>!window.__workerClient&&!window.__wildshard?.world);
 assert.equal(report.coldTitle,true);console.log('PASS cold title has no world or seat');
 await b.goto('https://staging.wildshard.io/?fps=30&mute=1&nolock=1');await b.locator('.ws-main-grid').waitFor({timeout:45000});await b.locator('.ws-main-grid').click();
 /** @param {import('playwright').Page} p @param {string} name */
 const named=async(p,name)=>{await p.locator('#ws-name-box input').waitFor({timeout:90000});await p.locator('#ws-name-box input').fill(name);await p.locator('#ws-name-box button[type=submit]').click();};
 /** @param {import('playwright').Page} p @param {string} name @param {boolean} [alreadyNamed] */
 const enter=async(p,name,alreadyNamed=false)=>{if(!alreadyNamed)await named(p,name);await p.waitForFunction(()=>window.__workerClient&&window.__wildshard?.world?.player,undefined,{timeout:90000});await p.evaluate(FLOOR_GRID_ENTER);await p.waitForFunction(()=>(window.__workerClient?.().frames??0)>30,undefined,{timeout:30000});};
 await enter(b,nameB);console.log('observer seated');
 const before=await b.evaluate(()=>window.__onlinePlayers?.()??[]);assert.equal(before.some(r=>new RegExp(playerNameSource(nameA),'u').test(r.name)),false);
 await a.locator('.ws-main-select').click();await named(a,nameA);await a.locator('.ws-menu-play').click();await enter(a,nameA,true);console.log('subject seated after Play');
 await b.waitForFunction(source=>window.__onlinePlayers?.().some(r=>new RegExp(source,'u').test(r.name)),playerNameSource(nameA),{timeout:15000});
 report.visibleAfterPlay=true;
 /** @param {import('playwright').Page} p */
 const where=async p=>{const value=await p.evaluate(()=>({inside:(/** @type {{state:()=>{inside:string|null}}} */(window.__wildshard.shard.grid)).state().inside,level:window.__wildshard.world?.game.level.id}));return value;};
 report.locations={select:await where(a),infinite:await where(b)};assert.equal(report.locations.select.inside,'driftwood-isle');assert.equal(report.locations.infinite.inside,'driftwood-isle');
 await a.waitForFunction(source=>window.__onlinePlayers?.().some(r=>new RegExp(source,'u').test(r.name)&&r.modelled),playerNameSource(nameB),{timeout:15000});
 /** @param {import('playwright').Page} p @param {string} line */
 const say=async(p,line)=>{await p.locator('#ws-chat input').fill(line);await p.locator('#ws-chat input').press('Enter');};
 await say(a,`grid A ${tag}`);await b.locator('#ws-chat',{hasText:`grid A ${tag}`}).waitFor({timeout:10000});await say(b,`grid B ${tag}`);await a.locator('#ws-chat',{hasText:`grid B ${tag}`}).waitFor({timeout:10000});report.chat=true;console.log('PASS both grid entry routes, bodies and chat');
 for(const p of[a,b]){
  await p.locator('#ws-voice').waitFor({timeout:30000});
  await p.evaluate(proofMicrophone);
  await p.locator('#ws-voice').click();
  await p.locator('#ws-voice[data-state=on]').waitFor({timeout:30000}).catch(async(/** @type {unknown} */ error)=>{
   console.log(JSON.stringify(await p.evaluate(()=>{
    const button=document.querySelector('#ws-voice');
    return {voice:button instanceof HTMLElement?button.dataset.state:undefined,tip:document.querySelector('#ws-voice-tip')?.textContent,mock:navigator.mediaDevices?.getUserMedia.toString().includes('AudioContext')};
   })));
   throw error;
  });
  await p.locator('#ws-chat input').click();
 }
 await a.locator('#ws-voice-peers button[data-linked=true]').waitFor({timeout:45000});await b.locator('#ws-voice-peers button[data-linked=true]').waitFor({timeout:45000});
 for(const p of[a,b])await p.locator('#ws-voice-peers button[data-speaking=true]').waitFor({timeout:20000}).catch(async(/** @type {unknown} */ error)=>{console.log(JSON.stringify(await p.evaluate(()=>({audio:Reflect.get(window,'__mmoAudio')?.audio?.state,peers:document.querySelector('#ws-voice-peers')?.textContent}))));throw error;});report.voiceBothWays=true;
 report.errors=faults;assert.deepEqual(faults,[]);console.log(JSON.stringify(report));writeFileSync(join(out,`grid-${engine}.json`),JSON.stringify(report,null,2));
} finally {await browser.close();}
