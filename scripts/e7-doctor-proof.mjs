// Manual E7 Doctor proof. J205: live checks only on staging; human checks are static.
import assert from 'node:assert/strict';
import {createPublicKey,verify} from 'node:crypto';
import {chromium,webkit,devices} from 'playwright';
import {KEYCHAIN_ARGS} from './chromium-keychain.mjs';
import {SOCKET_READY,SOCKET_RELIABLE,SOCKET_PING} from '../src/shared/engine/net/socketFrames.ts';

const [base,build,key]=process.argv.slice(2),human=process.argv.includes('--human-static'),origin=new URL(base).origin;
assert.equal(origin,human?'https://play.wildshard.io':'https://staging.wildshard.io');assert.match(build,/^[a-f0-9]{40}$/u);
const channel=human?'production':'staging',releaseURL=`https://wildshard-packs.wildshard.workers.dev/releases/${channel}.json`;
/** @param {string|URL} url */
async function read(url){const response=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,String(url));return response;}
const version=await(await read(new URL('/version.json',base))).json();assert.equal(version.build,build);assert.equal(version.saveEpoch,1);
const root=await(await read(new URL('/',base))).text(),document=await(await read(new URL('/doctor/',base))).text();
assert.ok(root.includes('data-doctor-door'));
const door=await fetch(new URL('/?doctor&chunk=driftwood-isle&from=link',base),{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(15000)});
assert.equal(door.status,307,'Doctor entry must redirect before any game HTML');
const redirectLocation=door.headers.get('location');assert.ok(redirectLocation!==null);const destination=new URL(redirectLocation,base);
assert.equal(destination.origin,origin);assert.equal(destination.pathname,'/doctor/');assert.equal(destination.searchParams.get('sw'),'0');assert.equal(destination.searchParams.get('chunk'),'driftwood-isle');assert.equal(destination.searchParams.get('from'),'link');
const worldText=/globalThis\.__WS_WORLD__=(\{[^;]+\});/u.exec(document)?.[1];assert.ok(worldText,'Doctor needs a release stamp');const world=JSON.parse(worldText);assert.equal(world.release,releaseURL);assert.equal(world.key,key);
const scripts=[...document.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gu)].map(match=>match[1]);assert.ok(scripts.length>0,'Doctor entry must be build scoped');assert.ok(scripts.every(path=>path!==undefined&&path.startsWith(`/b/${build}/doctor/`)),'Every external Doctor script must be build scoped');for(const path of scripts){assert.ok(path!==undefined);await read(new URL(path,base));}
const signed=await(await read(releaseURL)).json();assert.ok(verify(null,Buffer.from(signed.body),createPublicKey({key:Buffer.from(key,'hex'),format:'der',type:'spki'}),Buffer.from(signed.signature,'hex')));
const release=JSON.parse(signed.body);assert.equal(release.channel,channel);assert.equal(release.engineBuild,build);assert.equal(release.saveEpoch,1);
if(human){console.log('PASS human Doctor static publication',JSON.stringify({build,epoch:1,doctorEntry:true,signedProduction:true,productionSockets:0}));}else{
 // MS7: rooms-staging, or the Funnel for the one release that moves it; staging's /health stays tailnet-only (D7).
 const socket=release.socket.replace(/\/$/u,'');assert.ok(['wss://rooms-staging.wildshard.io','wss://wildshard.tailb41b20.ts.net:8443'].includes(socket),socket);
 const healthURL='https://wildshard.tailb41b20.ts.net:8443/health';
 const response=await fetch(healthURL,{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);assert.ok([origin,'*'].includes(response.headers.get('access-control-allow-origin')??''));
 const before=await response.json();assert.equal(before.build,build);assert.equal(before.serial,release.serial);assert.equal(typeof before.now,'number');
 for(const engine of ['chromium','webkit']){
  const browser=await(engine==='chromium'?chromium:webkit).launch({headless:true,args:engine==='chromium'?[...KEYCHAIN_ARGS,'--mute-audio',...(process.platform==='darwin'?['--use-angle=metal']:[])]:[]});
  const context=await browser.newContext({...devices['iPhone 16 Pro'],deviceScaleFactor:2});
  /** @type {string[]} */ const errors=[];
  /** @type {number[]} */ const prefixes=[];
  try{
   await context.grantPermissions(engine==='chromium'?['clipboard-read','clipboard-write']:['clipboard-read']);
   await context.addInitScript(allowed=>{const Native=WebSocket;globalThis.WebSocket=new Proxy(Native,{construct(target,args,newTarget){const url=new URL(String(args[0]),location.href);if(url.origin!==allowed||url.pathname!=='/'||url.search||url.hash)throw new Error('J205 refused non-staging Doctor socket');return Reflect.construct(target,args,newTarget);}});},socket);
   const started=Date.now(),page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});page.on('response',r=>{if(r.status()>=400)errors.push(`HTTP ${r.status()} ${r.url()}`);});
   page.on('requestfailed',r=>errors.push(`Request failed ${r.url()}: ${r.failure()?.errorText??'unknown'}`));page.on('crash',()=>errors.push('Native page crash'));
   page.on('websocket',ws=>{if(new URL(ws.url()).origin!==socket)errors.push('Non-staging Doctor socket');ws.on('socketerror',e=>errors.push(`Socket error ${e}`));ws.on('framesent',frame=>{if(!Buffer.isBuffer(frame.payload)){errors.push('Non-binary Doctor frame');return;}prefixes.push(frame.payload[0]??-1);});});
   await page.goto(new URL('/?doctor',base).href,{waitUntil:'load',timeout:90000});await page.waitForURL(url=>url.pathname==='/doctor/',{timeout:15000});
   await page.locator('#ws-doctor:not([data-running])[data-verdict]').waitFor({timeout:120000});
   const rows=await page.locator('.ws-doc-row').evaluateAll(nodes=>nodes.map(node=>{if(!(node instanceof HTMLElement))throw new Error('Doctor row must be an HTML element');return{id:node.dataset.check,state:node.dataset.state,value:node.querySelector('.ws-doc-value')?.textContent,ms:node.querySelector('.ws-doc-ms')?.textContent};}));
   assert.deepEqual(rows.map(row=>row.id),['page','release','packs','server','join','latency','browser']);assert.ok(rows.every(row=>row.state==='pass'),JSON.stringify(rows));
   assert.ok(rows.find(row=>row.id==='server')?.value?.includes(build.slice(0,7)),'Opaque reachability cannot replace a matching server');
   await page.getByRole('button',{name:'Copy report',exact:true}).click();await page.getByRole('button',{name:'Copied',exact:true}).waitFor({timeout:5000});
   const copied=await page.evaluate(()=>navigator.clipboard.readText());const reportAt=Date.parse(/^Wildshard connection doctor · ([^\n]+)/u.exec(copied)?.[1]??'');assert.ok(reportAt>=started&&reportAt<=Date.now(),'Clipboard must contain this run’s fresh native report');assert.ok(copied.includes(`build ${build}`));assert.ok(copied.includes('result all pass'));for(const row of rows)assert.ok(copied.includes(`${row.id} · pass`));
   assert.equal(prefixes.filter(prefix=>prefix===SOCKET_RELIABLE).length,1);assert.equal(prefixes.includes(SOCKET_READY),false);assert.ok(prefixes.some(prefix=>prefix===SOCKET_PING));assert.ok(prefixes.every(prefix=>prefix===SOCKET_RELIABLE||prefix===SOCKET_PING));
   await context.close();assert.deepEqual(errors,[],'No native exception or console error is filtered');
   const after=await(await read(healthURL)).json();assert.equal(after.build,build);console.log('Doctor player-count diagnostic (shared staging)',JSON.stringify({before:before.players,after:after.players}));
   console.log('PASS live staging Doctor',JSON.stringify({engine,build,epoch:1,rows,prefixes,clipboard:true,noReadyFrame:true,productionSockets:0}));
  }finally{await context.close();await browser.close();}
 }
}
