// Manual E7 Doctor proof. J205: live checks only on staging; human checks are static.
import { agentFetch as fetch } from './agent-requests.mjs';
import assert from 'node:assert/strict';
import {createPublicKey,verify} from 'node:crypto';
import {chromium,webkit,devices} from "./browser-playwright.mjs";
import {KEYCHAIN_ARGS} from './.kit/chromium-keychain.mjs';
import {PRIVATE_HEALTH_SKIPPED,privateHealthURL,roomsHealthURL,splitRoomsHealthLines} from './staging-proof-lines.mjs';
import {doctorEpochOK,doctorRowsOK} from './doctor-proof-rows.mjs';
import {isVersionUrl,WORKERS} from './page-release/hosts/workers.mjs';
import {SOCKET_READY,SOCKET_RELIABLE,SOCKET_PING} from '../shared/engine/net/socketFrames.ts';

const [base,build,key]=process.argv.slice(2),human=process.argv.includes('--human-static'),origin=new URL(base).origin;
// --engine=chromium|webkit runs one browser (verify-staging.yml runs each on its own runner); both by default.
const only=process.argv.find(arg=>arg.startsWith('--engine='))?.slice('--engine='.length);assert.ok(only===undefined||only==='chromium'||only==='webkit',only);
assert.equal(origin,human?'https://play.wildshard.io':'https://staging.wildshard.io');assert.match(build,/^[a-f0-9]{40}$/u);
const entry=process.argv.find(arg=>arg.startsWith('--candidate-entry='))?.slice('--candidate-entry='.length);
const candidateId=process.argv.find(arg=>arg.startsWith('--candidate-id='))?.slice('--candidate-id='.length);
if(entry!==undefined||candidateId!==undefined){
 assert.ok(!human&&entry!==undefined&&candidateId!==undefined&&isVersionUrl(entry,candidateId,WORKERS.staging.worker),'Expected the uploaded staging Worker version');
}
// The loopback candidate runs the page assets. Only the uploaded Worker implements its document redirect.
const staticBase=entry??base;
const channel=human?'production':'staging',releaseURL=`https://releases.wildshard.io/${channel}.json`;
/** @param {string|URL} url */
async function read(url){const response=await fetch(url,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});assert.equal(response.status,200,String(url));return response;}
const version=await(await read(new URL('/version.json',staticBase))).json();assert.equal(version.build,build);
const root=await(await read(new URL('/',staticBase))).text(),document=await(await read(new URL('/doctor/',staticBase))).text();
assert.ok(root.includes('data-doctor-door'));
const door=await fetch(new URL('/?doctor&from=link',staticBase),{cache:'no-store',redirect:'manual',signal:AbortSignal.timeout(15000)});
assert.equal(door.status,307,'Doctor entry must redirect before any game HTML');
const redirectLocation=door.headers.get('location');assert.ok(redirectLocation!==null);const destination=new URL(redirectLocation,staticBase);
assert.equal(destination.origin,new URL(staticBase).origin);assert.equal(destination.pathname,'/doctor/');assert.equal(destination.searchParams.get('sw'),'0');assert.ok(!destination.search.includes('driftwood-isle'),'the doctor names no zone in its address (CP7, J522)');assert.equal(destination.searchParams.get('from'),'link');
const worldText=/globalThis\.__WS_WORLD__=(\{[^;]+\});/u.exec(document)?.[1];assert.ok(worldText,'Doctor needs a release stamp');const world=JSON.parse(worldText);assert.equal(world.release,releaseURL);assert.equal(world.key,key);
const scripts=[...document.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/gu)].map(match=>match[1]);assert.ok(scripts.length>0,'Doctor entry must be build scoped');assert.ok(scripts.every(path=>path!==undefined&&path.startsWith(`/b/${build}/doctor/`)),'Every external Doctor script must be build scoped');for(const path of scripts){assert.ok(path!==undefined);await read(new URL(path,staticBase));}
const signed=await(await read(releaseURL)).json();assert.ok(verify(null,Buffer.from(signed.body),createPublicKey({key:Buffer.from(key,'hex'),format:'der',type:'spki'}),Buffer.from(signed.signature,'hex')));
const release=JSON.parse(signed.body);assert.equal(release.channel,channel);assert.equal(release.engineBuild,build);assert.ok(doctorEpochOK(version.saveEpoch,release.saveEpoch),'Page epoch must match the signature-verified release');
if(human){console.log('PASS human Doctor static publication',JSON.stringify({build,epoch:release.saveEpoch,doctorEntry:true,signedProduction:true,productionSockets:0}));}else{
 // MS7.3: the socket is rooms-staging; D7 health stays private on the tailnet.
 const socket=release.socket.replace(/\/$/u,'');assert.ok(['wss://rooms-staging.wildshard.io'].includes(socket),socket);
 const healthURL=privateHealthURL();
 /** @type {{players?:number}|undefined} */ let before;
 if(healthURL===undefined)console.log(PRIVATE_HEALTH_SKIPPED);else{
  const response=await fetch(healthURL,{headers:{Origin:origin},signal:AbortSignal.timeout(15000)});assert.equal(response.status,200);assert.ok([origin,'*'].includes(response.headers.get('access-control-allow-origin')??''));
  const health=await response.json();assert.equal(health.build,build);assert.equal(health.serial,release.serial);assert.equal(typeof health.now,'number');before=health;
 }
 for(const engine of only===undefined?['chromium','webkit']:[only]){
  const browser=await(engine==='chromium'?chromium:webkit).launch({headless:true,args:engine==='chromium'?[...KEYCHAIN_ARGS,'--mute-audio',...(process.platform==='darwin'?['--use-angle=metal']:[])]:[]});
  const context=await browser.newContext({...devices['iPhone 16 Pro'],deviceScaleFactor:2});
  /** @type {{text:string,url?:string}[]} */ const errors=[];
  /** @type {number[]} */ const prefixes=[];
  try{
   await context.grantPermissions(engine==='chromium'?['clipboard-read','clipboard-write']:['clipboard-read']);
   await context.addInitScript(allowed=>{const Native=WebSocket;globalThis.WebSocket=new Proxy(Native,{construct(target,args,newTarget){const url=new URL(String(args[0]),location.href);if(url.origin!==allowed||url.pathname!=='/'||url.search||url.hash)throw new Error('J205 refused non-staging Doctor socket');return Reflect.construct(target,args,newTarget);}});},socket);
   const started=Date.now(),page=await context.newPage();page.on('pageerror',e=>errors.push({text:e.message}));page.on('console',m=>{if(m.type()==='error')errors.push({text:m.text(),url:m.location().url});});page.on('response',r=>{if(r.status()>=400)errors.push({text:`HTTP ${r.status()} ${r.url()}`,url:r.url()});});
   page.on('requestfailed',r=>errors.push({text:`Request failed ${r.url()}: ${r.failure()?.errorText??'unknown'}`,url:r.url()}));page.on('crash',()=>errors.push({text:'Native page crash'}));
   page.on('websocket',ws=>{if(new URL(ws.url()).origin!==socket)errors.push({text:'Non-staging Doctor socket'});ws.on('socketerror',e=>errors.push({text:`Socket error ${e}`}));ws.on('framesent',frame=>{if(!Buffer.isBuffer(frame.payload)){errors.push({text:'Non-binary Doctor frame'});return;}prefixes.push(frame.payload[0]??-1);});});
   const pageEntry=entry===undefined?'/?doctor':`${destination.pathname}${destination.search}`;
   await page.goto(new URL(pageEntry,base).href,{waitUntil:'load',timeout:90000});await page.waitForURL(url=>url.pathname==='/doctor/',{timeout:15000});
   await page.locator('#ws-doctor:not([data-running])[data-verdict]').waitFor({timeout:120000});
   const rows=await page.locator('.ws-doc-row').evaluateAll(nodes=>nodes.map(node=>{if(!(node instanceof HTMLElement))throw new Error('Doctor row must be an HTML element');return{id:node.dataset.check,state:node.dataset.state,value:node.querySelector('.ws-doc-value')?.textContent,ms:node.querySelector('.ws-doc-ms')?.textContent};}));
   assert.ok(doctorRowsOK(rows,socket),JSON.stringify({rows,socketErrors:errors.filter(row=>row.text.startsWith('Socket error')),prefixes}));
   const serverRow=rows.find(row=>row.id==='server')?.value??'';
   // D7: on rooms-staging the page can't read /health, so the row says reachable; the tailnet health reads before and after prove the build.
   if(new URL(socket).host!=='rooms-staging.wildshard.io')assert.ok(serverRow.includes(build.slice(0,7)),'Opaque reachability cannot replace a matching server');
   await page.getByRole('button',{name:'Copy report',exact:true}).click();await page.getByRole('button',{name:'Copied',exact:true}).waitFor({timeout:5000});
   const copied=await page.evaluate(()=>navigator.clipboard.readText());const reportAt=Date.parse(/^Wildshard connection doctor · ([^\n]+)/u.exec(copied)?.[1]??'');assert.ok(reportAt>=started&&reportAt<=Date.now(),'Clipboard must contain this run’s fresh native report');assert.ok(copied.includes(`build ${build}`));assert.ok(copied.includes('result all pass'));for(const row of rows)assert.ok(copied.includes(`${row.id} · ${row.state}`));
   assert.equal(prefixes.filter(prefix=>prefix===SOCKET_RELIABLE).length,1);assert.equal(prefixes.includes(SOCKET_READY),false);assert.ok(prefixes.some(prefix=>prefix===SOCKET_PING));assert.ok(prefixes.every(prefix=>prefix===SOCKET_RELIABLE||prefix===SOCKET_PING));
   await context.close();
   // D7: the page's own fetch of the private rooms /health is a 404 with no CORS header; exactly those lines are listed, not failed.
   const lines=splitRoomsHealthLines(errors,roomsHealthURL(socket));console.log('D7 rooms health lines (listed)',JSON.stringify(lines.health));
   assert.deepEqual(lines.other,[],'No other native exception or console error is filtered');
   if(healthURL!==undefined){const after=await(await read(healthURL)).json();assert.equal(after.build,build);console.log('Doctor player-count diagnostic (shared staging)',JSON.stringify({before:before?.players,after:after.players}));}
   console.log('PASS live staging Doctor',JSON.stringify({engine,build,epoch:release.saveEpoch,rows,prefixes,clipboard:true,noReadyFrame:true,productionSockets:0}));
  }finally{await context.close();await browser.close();}
 }
}
