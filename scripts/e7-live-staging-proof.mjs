// Manual live proof. J205: staging only; never an agent socket on production.
import assert from 'node:assert/strict';
import {createPublicKey,verify} from 'node:crypto';
import {chromium,webkit,devices} from 'playwright';
import {KEYCHAIN_ARGS} from './chromium-keychain.mjs';
import {saveFixture} from './debug-settings.mjs';
import {chatLinePattern,playerNameSource,roomsHealthURL,splitRoomsHealthLines} from './staging-proof-lines.mjs';

const [base,build,key,engine]=process.argv.slice(2);
assert.equal(new URL(base).origin,'https://staging.wildshard.io','J205 requires the isolated staging page');
assert.match(build,/^[a-f0-9]{40}$/u);assert.match(key,/^[a-f0-9]+$/u);
assert.ok(engine==='chromium'||engine==='webkit');
// MS7: rooms-staging, or the Funnel for the one release that moves it; staging's /health stays tailnet-only (D7).
const releaseURL='https://wildshard-packs.wildshard.workers.dev/releases/staging.json',sockets=['wss://rooms-staging.wildshard.io','wss://wildshard.tailb41b20.ts.net:8443'];
const response=await fetch(releaseURL,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(30000)});assert.equal(response.status,200);
const signed=await response.json();assert.ok(verify(null,Buffer.from(signed.body),createPublicKey({key:Buffer.from(key,'hex'),format:'der',type:'spki'}),Buffer.from(signed.signature,'hex')));
const release=JSON.parse(signed.body);assert.equal(release.channel,'staging');assert.equal(release.engineBuild,build);assert.equal(release.saveEpoch,1);const socket=release.socket.replace(/\/$/u,'');assert.ok(sockets.includes(socket),socket);
const health=await(await fetch('https://wildshard.tailb41b20.ts.net:8443/health',{signal:AbortSignal.timeout(15000)})).json();assert.equal(health.build,build);assert.equal(health.serial,release.serial);
const version=await(await fetch(new URL('/version.json',base),{signal:AbortSignal.timeout(30000)})).json();assert.equal(version.build,build);assert.equal(version.saveEpoch,1);
const html=await(await fetch(base,{signal:AbortSignal.timeout(30000)})).text();assert.ok(html.includes(releaseURL));assert.ok(!html.includes('/releases/production.json'));
const browser=await(engine==='chromium'?chromium:webkit).launch({headless:true,args:engine==='chromium'?[...KEYCHAIN_ARGS,'--mute-audio',...(process.platform==='darwin'?['--use-angle=metal']:[])]:[]});
/** @type {{page:import('playwright').Page,context:import('playwright').BrowserContext,name:string}[]} */
const opened=[];
/** @type {{name:string,text:string,url?:string}[]} */
const faults=[];
try{
 /** @param {string} name */
 const enter=async name=>{
  const context=await browser.newContext({...devices['iPhone 16 Pro'],deviceScaleFactor:2});
  await context.addInitScript(allowed=>{
   const Native=globalThis.WebSocket;
   // Refuse before native construction. Successful sockets use the untouched
   // browser transport, TLS and protocol; no relay or fake frames are installed.
   globalThis.WebSocket=new Proxy(Native,{construct(target,args,newTarget){
    const url=new URL(String(args[0]),location.href);
    if(url.origin!==allowed||url.pathname!=='/'||url.search||url.hash)throw new Error('J205 refused a non-staging socket');
    return Reflect.construct(target,args,newTarget);
   }});
  },socket);
  await saveFixture(context,{scope:'device',key:'devMode',data:true});
  await saveFixture(context,{scope:'global',key:'settings',data:{music:false,sfx:false,volume:0},merge:true});
  const page=await context.newPage();opened.push({page,context,name});
  page.on('pageerror',e=>faults.push({name,text:e.message}));
  page.on('console',m=>{if(m.type()==='error')faults.push({name,text:m.text(),url:m.location().url});});
  page.on('response',result=>{if(result.status()>=400)faults.push({name,text:`HTTP ${result.status()} ${result.url()}`,url:result.url()});});
  page.on('requestfailed',r=>faults.push({name,text:`Request failed ${r.url()}: ${r.failure()?.errorText??'unknown'}`,url:r.url()}));page.on('crash',()=>faults.push({name,text:'Native page crash'}));
  page.on('websocket',ws=>{if(new URL(ws.url()).origin!==socket)faults.push({name,text:'Non-staging live socket'});ws.on('socketerror',e=>faults.push({name,text:`Socket error ${e}`}));console.log('NATIVE STAGING SOCKET',engine,name,ws.url());});
  console.log('STAGING PAGE ACTION',engine,name,'navigate');
  await page.goto(new URL('/?chunk=driftwood-isle&mute=1&nolock=1&skipintro=1',base).href,{waitUntil:'load',timeout:90000});
  console.log('STAGING PAGE ACTION',engine,name,'wait for real Name form');
  await page.locator('#ws-name-box input').waitFor({timeout:150000});
  await page.locator('#ws-name-box input').fill(name);await page.locator('#ws-name-box button[type=submit]').click();
  await page.waitForFunction(()=>typeof window.__workerClient==='function'&&window.__wildshard?.world?.player!==undefined,undefined,{timeout:120000});
  await page.evaluate(()=>{const world=window.__wildshard?.world;if(world===undefined)throw new Error('World missing');world.hud.enterNow();});
  await page.waitForFunction(()=>(window.__workerClient?.().frames??0)>30,undefined,{timeout:60000});
  const paused=await page.evaluate(()=>window.__wildshard?.world?.game.app.clock.paused===true);
  if(paused)await page.getByRole('button',{name:/^resume$/iu}).click();
  await page.waitForFunction(()=>window.__wildshard?.world?.game.app.clock.paused===false,undefined,{timeout:20000});
  assert.equal(await page.evaluate(()=>Reflect.get(globalThis,'__WS_BUILD_ID__')),build);
  return page;
 };
 const tag=`${engine==='chromium'?'C':'W'} ${Date.now().toString(36).slice(-4)}`,aName=`Agent ${tag} A`,bName=`Agent ${tag} B`,a=await enter(aName),b=await enter(bName);
 // MP2.4: the server shows each Name with its tag (`Name#1234`).
 for(const page of[a,b]){const name=page===a?bName:aName;await page.waitForFunction(source=>window.__onlinePlayers?.().some(row=>new RegExp(source,'u').test(row.name)&&row.modelled),playerNameSource(name),{timeout:20000});}
 console.log('PASS both real bodies and names',engine);
 const before=await b.evaluate(()=>{const row=window.__workerClient?.();if(row===undefined)throw new Error('Authoritative observer missing');return{x:row.serverX,z:row.serverZ};});
 await b.keyboard.down('KeyW');
 try{await Promise.all([a.waitForFunction(source=>window.__onlinePlayers?.().some(row=>new RegExp(source,'u').test(row.name)&&(row.gait==='walk'||row.gait==='run')),playerNameSource(bName),{timeout:20000}),b.waitForFunction(stood=>{const row=window.__workerClient?.();return row!==undefined&&Math.hypot(row.serverX-stood.x,row.serverZ-stood.z)>.01;},before,{timeout:20000})]);}finally{await b.keyboard.up('KeyW');}
 console.log('PASS authoritative movement and remote walk',engine,before);
 const after=await b.evaluate(()=>{const row=window.__workerClient?.();if(row===undefined)throw new Error('Authoritative observer missing');return{x:row.serverX,z:row.serverZ};});assert.ok(Math.hypot(after.x-before.x,after.z-before.z)>.01);
 const line=`agent proof ${engine} ${build.slice(0,7)}`;await b.locator('#ws-chat input').fill(line);await b.locator('#ws-chat input').press('Enter');
 for(const page of[a,b])await page.locator('#ws-chat',{hasText:chatLinePattern(bName,line)}).waitFor({timeout:10000});
 // D7: the page's own fetch of the private rooms /health is a 404 with no CORS header; exactly those lines are listed, not failed.
 const lines=splitRoomsHealthLines(faults,roomsHealthURL(socket));console.log('D7 rooms health lines (listed)',JSON.stringify(lines.health));
 assert.deepEqual(lines.other,[],'No other page or console error may be filtered');
 console.log('PASS live staging play',JSON.stringify({engine,build,epoch:1,channel:'staging',socket,bodies:2,walk:true,chat:true,errors:0,productionConnections:0}));
}catch(error){
 for(const row of opened){const state=await row.page.evaluate(()=>({build:Reflect.get(globalThis,'__WS_BUILD_ID__'),url:location.href,text:(document.body.textContent??'').slice(-2500),active:Reflect.get(globalThis,'__bootTiming')?.read().active,worker:window.__workerClient?.(),players:window.__onlinePlayers?.()})).catch((/** @type {unknown} */ reading)=>({reading:String(reading)}));console.error('LIVE STAGING REFUSAL',JSON.stringify({name:row.name,state,faults}));}
 throw error;
}finally{for(const row of opened)await row.context.close();await browser.close();}
