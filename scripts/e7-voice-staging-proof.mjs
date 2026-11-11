// Manual voice proof (J218 V6). J205: staging only; never an agent socket on production. Two real game pages on the staging page
// join voice, link peer to peer and each hears the other. The mic is a WebAudio beep: headless Chromium never answers getUserMedia.
//   node scripts/e7-voice-staging-proof.mjs https://staging.wildshard.io/ <engine-sha> <release-key-hex> [out-dir]
// v0.1.9's distance fade (VOICE-POLISH V7) silences a talker from 40 m, so the two stand within hearing range before either talks:
// both take a fresh seat (the server stands fresh joiners a metre apart) and the proof measures the gap before voice starts.
import assert from 'node:assert/strict';
import {createPublicKey,verify} from 'node:crypto';
import {mkdirSync} from 'node:fs';
import {chromium,devices} from 'playwright';
import {KEYCHAIN_ARGS} from './chromium-keychain.mjs';
import {saveFixture} from './debug-settings.mjs';
import {playerNameSource} from './staging-proof-lines.mjs';
import {VOICE_FULL_M} from '../src/client/engine/net/voiceNear.ts';

const [base,build,key,out=new URL('../tmp/e7-voice-staging/',import.meta.url).pathname]=process.argv.slice(2);
assert.equal(new URL(base).origin,'https://staging.wildshard.io','J205 requires the isolated staging page');
assert.match(build,/^[a-f0-9]{40}$/u);assert.match(key,/^[a-f0-9]+$/u);mkdirSync(out,{recursive:true});
const releaseURL='https://wildshard-packs.wildshard.workers.dev/releases/staging.json',sockets=['wss://rooms-staging.wildshard.io','wss://wildshard.tailb41b20.ts.net:8443'];
const signed=await(await fetch(releaseURL,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)})).json();
assert.ok(verify(null,Buffer.from(signed.body),createPublicKey({key:Buffer.from(key,'hex'),format:'der',type:'spki'}),Buffer.from(signed.signature,'hex')));
const release=JSON.parse(signed.body);assert.equal(release.channel,'staging');assert.equal(release.engineBuild,build);const socket=release.socket.replace(/\/$/u,'');assert.ok(sockets.includes(socket),socket);
const version=await(await fetch(new URL('/version.json',base),{cache:'no-store',signal:AbortSignal.timeout(30000)})).json();assert.equal(version.build,build);
const browser=await chromium.launch({headless:true,args:[...KEYCHAIN_ARGS,'--mute-audio',...(process.platform==='darwin'?['--use-angle=metal']:[]),'--autoplay-policy=no-user-gesture-required']});
/** @type {string[]} */ const faults=[];
/** @type {Record<string,unknown>} */ const results={};
try{
 /** @param {string} name @param {boolean} phone */
 const enter=async(name,phone)=>{
  const context=await browser.newContext(phone?{...devices['iPhone 16 Pro'],deviceScaleFactor:2}:{viewport:{width:1440,height:900}});
  await context.addInitScript(allowed=>{
   const Native=globalThis.WebSocket;
   globalThis.WebSocket=new Proxy(Native,{construct(target,args,newTarget){
    const url=new URL(String(args[0]),location.href);
    if(url.origin!==allowed)throw new Error('J205 refused a non-staging socket');
    return Reflect.construct(target,args,newTarget);
   }});
   navigator.mediaDevices.getUserMedia=()=>{
    const ctx=new AudioContext(),osc=ctx.createOscillator(),gain=ctx.createGain(),dest=ctx.createMediaStreamDestination();
    osc.connect(gain);gain.connect(dest);osc.start();gain.gain.value=.6;
    setInterval(()=>{gain.gain.value=gain.gain.value>0?0:.6;},600);
    void ctx.resume();return Promise.resolve(dest.stream);
   };
  },socket);
  await saveFixture(context,{scope:'device',key:'devMode',data:true});
  // MG5: a phone's first play skips SHARD SELECT for the first-play card; this proof plays as a returning phone.
  if(phone)await saveFixture(context,{scope:'device',key:'firstPlayDone',data:true});
  await saveFixture(context,{scope:'global',key:'settings',data:{music:false,sfx:false,volume:0},merge:true});
  const page=await context.newPage();
  page.on('pageerror',e=>{faults.push(`${name}: ${e.message}`);});
  await page.goto(new URL('/?chunk=driftwood-isle&mute=1&nolock=1&skipintro=1',base).href,{waitUntil:'load',timeout:90000});
  await page.locator('#ws-name-box input').waitFor({timeout:150000});
  await page.locator('#ws-name-box input').fill(name);await page.locator('#ws-name-box button[type=submit]').click();
  await page.waitForFunction(()=>typeof window.__workerClient==='function'&&window.__wildshard?.world?.player!==undefined,undefined,{timeout:120000});
  await page.evaluate(()=>{const world=window.__wildshard?.world;if(world===undefined)throw new Error('World missing');world.hud.enterNow();});
  await page.waitForFunction(()=>(window.__workerClient?.().frames??0)>30,undefined,{timeout:60000});
  if(await page.evaluate(()=>window.__wildshard?.world?.game.app.clock.paused===true))await page.getByRole('button',{name:/^resume$/iu}).click();
  await page.waitForSelector('#ws-voice',{timeout:180000});
  console.log('voice button up',name);
  return page;
 };
 const tag=Date.now().toString(36).slice(-4),aName=`Agent ${tag} A`,bName=`Agent ${tag} B`,a=await enter(aName,true),b=await enter(bName,false);
 // Each page draws the other's body: the distance voice fades by is measured between those bodies, so read it the same way.
 /** @param {import('playwright').Page} page @param {string} other */
 const gap=async(page,other)=>{
  await page.waitForFunction(source=>window.__onlinePlayers?.().some(row=>new RegExp(source,'u').test(row.name)&&row.modelled),playerNameSource(other),{timeout:30000});
  return page.evaluate(source=>{const me=window.__workerClient?.(),row=window.__onlinePlayers?.().find(shown=>new RegExp(source,'u').test(shown.name));if(me===undefined||row===undefined)throw new Error('Bodies missing');return Math.hypot(row.x-me.serverX,row.z-me.serverZ);},playerNameSource(other));
 };
 const gaps={a:await gap(a,bName),b:await gap(b,aName)};results.gap=gaps;console.log('gap between bodies (m)',JSON.stringify(gaps));
 for(const metres of [gaps.a,gaps.b])assert.ok(metres<=VOICE_FULL_M,`The two must stand within full voice (${VOICE_FULL_M} m), not ${metres} m`);
 await a.screenshot({path:`${out}/staging-phone-off.png`});
 // The seat (and so voice's `you`) comes once the cell has loaded; tapping before it only waits.
 await a.locator('#ws-voice').click();await a.waitForSelector('#ws-voice[data-state=on]',{timeout:120000});
 await b.waitForFunction(()=>document.querySelector('#ws-voice-tip span')?.textContent?.includes('on voice'),undefined,{timeout:60000});
 results.joinPrompt=await b.textContent('#ws-voice-tip span');
 await b.locator('#ws-voice').click();await b.waitForSelector('#ws-voice[data-state=on]',{timeout:120000});
 // QA43 keeps peer chips in the expanded chat: open its input before reading the linked and speaking chips.
 await a.locator('#ws-chat input').click();await b.locator('#ws-chat input').click();
 await a.waitForSelector('#ws-voice-peers button[data-linked=true]',{timeout:45000});
 await b.waitForSelector('#ws-voice-peers button[data-linked=true]',{timeout:45000});
 results.linked=true;
 results.aHearsB=await a.waitForSelector('#ws-voice-peers button[data-speaking=true]',{timeout:20000}).then(()=>true,()=>false);
 results.bHearsA=await b.waitForSelector('#ws-voice-peers button[data-speaking=true]',{timeout:20000}).then(()=>true,()=>false);
 results.far={a:await a.locator('#ws-voice-peers button[data-far=true]').count(),b:await b.locator('#ws-voice-peers button[data-far=true]').count()};
 await a.screenshot({path:`${out}/staging-phone-on.png`});await b.screenshot({path:`${out}/staging-desktop-on.png`});
 await b.locator('#ws-voice').click();await b.waitForSelector('#ws-voice[data-state=off]');
 await a.waitForFunction(()=>document.querySelectorAll('#ws-voice-peers button').length===0,undefined,{timeout:20000});
 results.leave=true;
}finally{await browser.close();}
console.log(JSON.stringify({...results,faults},null,2));
for(const field of ['linked','aHearsB','bHearsA','leave'])assert.equal(results[field],true,field);
assert.deepEqual(results.far,{a:0,b:0},'Neither page may show the other as too far');
assert.match(String(results.joinPrompt),/on voice/u);
assert.deepEqual(faults,[],'No page error may be filtered');
console.log('PASS staging voice',JSON.stringify({build,socket,linked:true,bothWays:true,leave:true,errors:0,productionConnections:0}));
