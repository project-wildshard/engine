// J383: immutable shipped legacy bytes, one local origin, real persistent WebKit profiles. Never joins a remote world.
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve as absolute } from 'node:path';
import { devices, webkit } from "./browser-playwright.mjs";

const [originsFile, candidate, workArg, selected = 'v022', style = 'browser'] = process.argv.slice(2);
if (!originsFile || !candidate || !workArg) throw new Error('force-update-proof <legacy origins JSON> <candidate origin> <fresh work> [v019|v022|v023] [browser|standalone]');
const origins = JSON.parse(readFileSync(originsFile, 'utf8'));
const work = absolute(workArg); mkdirSync(work);
let upstream = origins[selected];
if (typeof upstream !== 'string' || !/^https:\/\/[a-z0-9.-]+\.workers\.dev$/u.test(upstream)) throw new Error('Expected an immutable legacy Worker URL');
const target = new URL(candidate);
if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') throw new Error('Candidate must be the owned local preview');
const legacy = await (await fetch(`${upstream}/version.json`)).json();
const current = await (await fetch(`${candidate}/version.json`)).json();
if (selected === 'v022' && legacy.build !== 'ad3996fc13f8b63e33eb907da631fb496c984079') throw new Error('Not the exact v0.1.22 phone build');
/** @param {import('node:http').IncomingMessage} request @param {import('node:http').ServerResponse} response */
async function serve(request, response) {
  if (request.method !== 'GET') {response.writeHead(405).end();return;}
  try {
    const remote = await fetch(new URL(request.url ?? '/', upstream), {redirect:'error',signal:AbortSignal.timeout(30000)});
    const headers = Object.fromEntries(remote.headers);
    for(const key of ['content-encoding','content-length','transfer-encoding','connection','etag','last-modified'])delete headers[key];
    headers['cache-control']='no-store';
    // Native CSP guards remote API writes and world sockets without Playwright network interception changing WebKit SW behavior.
    headers['content-security-policy']="default-src 'self' data: blob: https://packs.wildshard.io; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' https://packs.wildshard.io";
    const body=Buffer.from(await remote.arrayBuffer());if(!response.destroyed)response.writeHead(remote.status,headers).end(body);
  }catch {if(!response.destroyed)response.writeHead(502,{'cache-control':'no-store'}).end('Owned fixture upstream unavailable');}
}
const server = createServer((request,response)=>{void serve(request,response);});
server.listen(0,'127.0.0.1');await once(server,'listening');
const address=server.address();if(address===null||typeof address==='string')throw new Error('No owned local port');
const local=`http://127.0.0.1:${String(address.port)}`, path='/slug/nine-dragon-stack';
const profile=join(work,'profile');
let context;
const errors=/** @type {string[]} */ ([]);
// A worker can replace a navigation itself. Accept only that native interruption;
// the following build/controller/menu assertions still have to succeed.
/** @param {() => Promise<unknown>} navigate */
async function workerNavigation(navigate){
  try{await navigate();}catch(error){if(!(error instanceof Error)||!error.message.includes('Frame load interrupted'))throw error;}
}
async function launch(){
  const ctx=await webkit.launchPersistentContext(profile,{headless:true,userAgent:devices['iPhone 17 Pro'].userAgent,viewport:{width:402,height:874},screen:{width:402,height:874},isMobile:true,hasTouch:true,deviceScaleFactor:1});
  if(style==='standalone')await ctx.addInitScript(()=>{Object.defineProperty(navigator,'standalone',{get:()=>true});const native=window.matchMedia.bind(window);window.matchMedia=query=>query==='(display-mode: standalone)'?new Proxy(native(query),{get:(media,key)=>{if(key==='matches')return true;const value=Reflect.get(media,key,media);return typeof value==='function'?value.bind(media):value;}}):native(query);});
  return ctx;
}
try{
  context=await launch();let page=context.pages()[0]??await context.newPage();
  page.on('pageerror',error=>{errors.push(error.name);});
  await page.goto(local+path,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(build=>Reflect.get(globalThis,'__WS_BUILD_ID__')===build,legacy.build,{timeout:30000});
  await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js',{scope:'/',updateViaCache:'all'});});
  await page.waitForFunction(async()=>{const registration=await navigator.serviceWorker.getRegistration();return registration?.active!==null&&registration?.active!==undefined;},undefined,{timeout:45000});
  await workerNavigation(()=>page.reload({waitUntil:'domcontentloaded'}));
  await page.waitForFunction(build=>Reflect.get(globalThis,'__WS_BUILD_ID__')===build,legacy.build,{timeout:45000});
  await page.waitForFunction(()=>navigator.serviceWorker.controller!==null,undefined,{timeout:45000});
  await page.evaluate(async()=>{
    localStorage.setItem('j383.settings','preserve');localStorage.setItem('j383.account','preserve');
    const cache=await caches.open('j383-old-download');await cache.put('/old-cache-proof',new Response('old'));
    await new Promise((resolve,reject)=>{const request=indexedDB.open('ws-built-home-v1');request.onupgradeneeded=()=>{request.result.createObjectStore('proof');};request.onsuccess=()=>{request.result.close();resolve(undefined);};request.onerror=()=>reject(request.error??new Error('Pack fixture refused'));});
    await new Promise((resolve,reject)=>{const request=indexedDB.open('wildshard-saves@12345');request.onupgradeneeded=()=>{request.result.createObjectStore('proof');};request.onsuccess=()=>{request.result.close();resolve(undefined);};request.onerror=()=>reject(request.error??new Error('Save fixture refused'));});
  });
  await page.screenshot({path:join(work,'before.jpg'),type:'jpeg',quality:75});
  await context.close();context=undefined;
  upstream=candidate;
  const started=Date.now();context=await launch();page=context.pages()[0]??await context.newPage();
  page.on('pageerror',error=>{errors.push(error.name);});
  await workerNavigation(()=>page.goto(local+path,{waitUntil:'domcontentloaded',timeout:60000}));
  await page.waitForFunction(build=>Reflect.get(globalThis,'__WS_BUILD_ID__')===build,current.build,{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('[data-title-shell]')===null&&document.querySelector('#hud.intro .ws-menu:not(.hide),#hud.intro .ws-main:not(.hide),#hud.intro .ws-menu-carousel')!==null,undefined,{timeout:60000});
  const elapsed=Date.now()-started;
  const state=await page.evaluate(async()=>({build:Reflect.get(globalThis,'__WS_BUILD_ID__'),path:location.pathname,settings:localStorage.getItem('j383.settings'),account:localStorage.getItem('j383.account'),oldCache:await caches.has('j383-old-download'),databases:(await indexedDB.databases()).map(row=>row.name),standalone:Reflect.get(navigator,'standalone')===true}));
  await page.screenshot({path:join(work,'after.jpg'),type:'jpeg',quality:75});
  const pass=state.build===current.build&&state.settings==='preserve'&&state.account==='preserve'&&!state.oldCache&&!state.databases.includes('ws-built-home-v1')&&state.databases.includes('wildshard-saves@12345')&&state.path===path&&(style!=='standalone'||state.standalone);
  writeFileSync(join(work,'receipt.json'),JSON.stringify({legacy:legacy.build,legacyLabel:legacy.describe,candidate:current.build,style,oneLaunch:true,elapsedMs:elapsed,state,errors,pass},null,2));
  console.log(JSON.stringify({legacy:legacy.describe,candidate:current.build,style,elapsedMs:elapsed,pass}));
  if(!pass)process.exitCode=1;
}finally{await context?.close();server.closeAllConnections();await server[Symbol.asyncDispose]();}
