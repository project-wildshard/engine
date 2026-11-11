// Shardfile vs Legacy Golden (G859): capture the 24 SHARDFILE frames at the goldens' cameras.
// Carried from singleplayer's art/legacy-goldens/compare/ (REPO-KIT K9). Same entry and settings as the LEGACY goldens (G843): muted Chromium, iPhone 16 Pro portrait, phone tier, 2x,
// seed 357, saved midday / clear, fresh context per shard through SHARD SELECT. The recorded cameras24 set is default.
// Run through scripts/browser-lane.sh on a serve-build.sh preview (version.json is the source authority).
//
//   node scripts/goldens/capture.mjs --base=http://127.0.0.1:44xx/ --out=tmp/golden-compare/raw [--shards=a,b]
//     [--cameras=<shard repo>/art/goldens/cameras24.json, default scripts/perf/cameras24.json] [--cams=1,5,9] [--textures=ktx2|img] [--no-astc]
// --no-astc hides WEBGL_compressed_texture_astc, so a phone profile takes the path of a phone GPU that has none (S4's overlays).
// --cameras: the 24-camera set (G859); its frames hide every element but the canvases (no HUD), at device pixels, named <nn>-<camera>-<mode>.png. A camera
// without an eye takes the player's settled eye plus its lift; receipts-<slug>.json records it. The LEGACY frames are
// frozen: the LEGACY entry is gone (QD7 LD5), so --mode=legacy refuses and every run enters by ENTER WORLD.
// The eye is the game's own camera (NR10 / NR12, sp-o5): a late hook sets it on every frame, so what the game culls and
// streams in its update (instanced dressing, the tile ring, coarse masks) follows the eye. A free camera (its eye more than
// FREE m from the probe's) poses the player under the eye, hovering, so the ring and colliders stand round the camera as
// they would round a player there (its board, on the camera and under it, is hidden for the shot); an eye-height camera
// keeps its probe. LIVE frames run at the eye before the shot. A worker page's board is a press the server hears a command
// later, and the server drops it on a pose: `board` asks, then waits for the answer, so a press never lands after the pose
// and turns the board back on. ON_FOOT: a board that shows in the frame. It stows Sky's fan and fills its hover decks, and
// its goldens have neither, so a player hovering there for its streaming steps off for the shot.
import {chromium,webkit,devices} from 'playwright';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {saveFixture,developerSettings,hideDeveloperOverlays,levelDownloadFixtures} from '../debug-settings.mjs';
import {loadingCardIndex} from '../loading-benchmark/catalogue.mjs';
import {pressEscape} from '../parity/browser-escape.mjs';
import {KEYCHAIN_ARGS} from '../chromium-keychain.mjs';
import {DEFAULT_GOLDEN_CAMERAS,goldenPreviewIdentity,selectGoldenShards,selectGoldenCameraNumbers} from './capture-inputs.mjs';
import {goldenRefinementBinding,observeRefinement,heldGoldenResidency,queueGoldenResidencyInstall} from './native-residency.mjs';

const arg=(k,d)=>process.argv.find(x=>x.startsWith(`--${k}=`))?.slice(k.length+3)??d;
const base=arg('base',''),root=arg('out','tmp/golden-compare/raw');
if(!base)throw Error('--base=<preview url> is required');
const source=goldenPreviewIdentity(await(await fetch(new URL('/version.json',base))).json(),arg('sha',''));
const head=source.sha;
const set=arg('cameras',DEFAULT_GOLDEN_CAMERAS);const mode=arg('mode','shardfile');if(mode!=='shardfile')throw Error(`--mode=${mode}: the LEGACY entry is gone (QD7 LD5); only shardfile captures`);
if(!set)throw Error('--cameras requires a camera-set path');
const canonical=JSON.parse(readFileSync(set,'utf8')).cameras;
const exp=arg('exp','')?readFileSync(arg('exp',''),'utf8'):'';// --exp=<file.js>: diagnostics only, run in the page before the held shot (its return value lands in the receipt)
const only=selectGoldenCameraNumbers(arg('cams',''));
const slugs=selectGoldenShards(canonical,arg('shards',undefined));
const nativeBinding=mode==='shardfile'&&slugs.includes('nine-dragon-stack')?await goldenRefinementBinding(base,source):null;
const FRAMES=120,SETTLE_MS=30000,LIVE=60,FREE=4,EYE=1.7,ON_FOOT=new Set(['far-reach']);
// --textures=ktx2|img pins the page's texture mode (the harness pin, src/engine/boot/gpuFiles.ts) to judge a texture-policy
// change on a clean build; omitted, the shipped Auto policy picks
const TEXTURES=arg('textures','');if(!['','ktx2','img'].includes(TEXTURES))throw Error(`--textures=${TEXTURES}`);
const NO_ASTC=process.argv.includes('--no-astc');
const hideAstc=()=>{const ext='WEBGL_compressed_texture_astc';for(const gl of [WebGLRenderingContext,WebGL2RenderingContext]){const{getExtension,getSupportedExtensions}=gl.prototype;
 gl.prototype.getExtension=function(name){return name===ext?null:getExtension.call(this,name);};
 gl.prototype.getSupportedExtensions=function(){return getSupportedExtensions.call(this)?.filter(name=>name!==ext)??null;};}};
// --level-download=packs|shardfile (DL16): Debug ▸ Loading & memory ▸ Level download for every capture (default: the build's)
const LEVEL_DOWNLOAD=arg('level-download','');if(!['','packs','shardfile'].includes(LEVEL_DOWNLOAD))throw Error(`--level-download=${LEVEL_DOWNLOAD}`);
mkdirSync(root,{recursive:true});

// --engine=webkit: Playwright's WebKit (muted by the game's volume 0; its Escape is a plain key press)
const engine=arg('engine','chromium'),throttle=Number(arg('cpu-throttle','1'));if(!(throttle>=1))throw Error('--cpu-throttle=<n >= 1>');if(!['chromium','webkit'].includes(engine))throw Error(`--engine=${engine}`);
const owner=engine==='webkit'?null:await chromium.launchServer({headless:true,args:[...KEYCHAIN_ARGS,'--mute-audio','--use-angle=metal','--ignore-gpu-blocklist','--remote-debugging-port=0']});
const directory=owner?.process().spawnargs.find(x=>x.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
const [port,path]=owner?(await readFile(`${directory}/DevToolsActivePort`,'utf8')).trim().split('\n'):[];
const endpoint=owner?`ws://127.0.0.1:${port}${path}`:'';
const browser=owner?await chromium.connectOverCDP(endpoint):await webkit.launch({headless:true}),rows=[];

const frames=(page,n)=>page.evaluate(async n=>{const g=window.__wildshard.world.game,from=g.frameCount;
 await new Promise(r=>{const f=()=>g.frameCount>=from+n?r():requestAnimationFrame(f);requestAnimationFrame(f);});},n);

// On or off the board, as the server has it. True when it holds.
const board=(page,on)=>page.evaluate(async on=>{const w=window.__wildshard.world,p=w.player;if(!p.setHover)return true;
 const wait=n=>new Promise(r=>{const from=w.game.frameCount,f=()=>w.game.frameCount>=from+n?r():requestAnimationFrame(f);f();});
 for(let asked=0;asked<4;asked++){await wait(15);if(p.hover===on)return true;p.setHover(on);}
 await wait(15);return p.hover===on;},on);

// Streaming idle: no request in flight for 1.5 s and, when a grid is present, no ring tile in flight or queued.
// A request open for more than 15 s is a long-lived one (it stays open across every pose), not streaming.
async function settle(page,inflight){
 const t0=Date.now();let quietSince=0;
 while(Date.now()-t0<SETTLE_MS){
  for(const [r,at]of inflight)if(Date.now()-at>15000)inflight.delete(r);
  const grid=await page.evaluate(()=>{const s=window.__wildshard?.shard?.grid?.state?.();return s?{inFlight:s.rings?.inFlight??0,queued:s.rings?.queued??0}:null;}).catch(()=>null);
  const quiet=inflight.size===0&&(!grid||(grid.inFlight===0&&grid.queued===0));
  if(quiet){quietSince||=Date.now();if(Date.now()-quietSince>=1500)return{settled:true,ms:Date.now()-t0};}else quietSince=0;
  await frames(page,10);
 }
 return{settled:false,ms:Date.now()-t0,inflight:[...inflight.keys()].slice(0,5).map(r=>r.url())};
}

try{for(const slug of slugs){
 const dir=`${root}/${slug}`;mkdirSync(dir,{recursive:true});
 const row={slug,head,engine,device:'iPhone 16 Pro',tier:'phone',dpr:2,seed:357,levelDownload:LEVEL_DOWNLOAD===''?'default':LEVEL_DOWNLOAD,errors:[],warnings:{},poses:[]};
 const context=await browser.newContext({...devices['iPhone 16 Pro']});let page;
 try{
  await developerSettings(context,{tier:'phone',volume:0,time:'midday',weather:'clear'});
  await saveFixture(context,{scope:'global',key:'gfx',data:{dpr:'2',aa:'auto'}});
  await saveFixture(context,{scope:'device',key:'debug.global.holdLoading',data:'off'});
  if (LEVEL_DOWNLOAD!=='') for (const fixture of levelDownloadFixtures(LEVEL_DOWNLOAD)) await saveFixture(context,fixture);
  // --device-save=<key>=<value>: a Debug row's device slot for a look A / B (D227's debug.gltfMips=on); repeatable
  for (const pair of process.argv.filter(x=>x.startsWith('--device-save=')).map(x=>x.slice(14))) {
    const at=pair.indexOf('='); if (at<1) throw Error(`--device-save=${pair}: key=value`);
    await saveFixture(context,{scope:'device',key:pair.slice(0,at),data:pair.slice(at+1)});
  }
  await context.addInitScript(hideDeveloperOverlays);
  if(NO_ASTC)await context.addInitScript(hideAstc);
  await context.addInitScript(textures=>{window.__wildshardHarness={seed:357,capture:null,...(textures===''?{}:{textures})};},TEXTURES);
  if (slug==='nine-dragon-stack'&&nativeBinding!==null) await context.addInitScript(`window.__installGoldenResidency=()=>window.__goldenResidencyPromise??=(async()=>{
    try {
      if(document.readyState==='loading'||window.__wildshard?.world?.hud?.entered)throw new Error('Native observer requires DOM readiness before world entry');
      const binding=${JSON.stringify(nativeBinding)},bytes=await(await fetch(binding.chunk)).arrayBuffer();
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(word=>word.toString(16).padStart(2,'0')).join('');
      if(hash!==binding.chunkSHA256)throw new Error('Native refinement module changed');
      const native=await import(new URL(binding.chunk,location.href).href);native[binding.initializerExport]();
      window.__goldenResidency=(${observeRefinement.toString()})(native[binding.classExport].prototype);
    }catch(error){window.__goldenResidencyFailure=String(error);}
  })(); (${queueGoldenResidencyInstall.toString()})(window.__installGoldenResidency);`);
  page=await context.newPage();page.setDefaultTimeout(30000);
  // --cpu-throttle=<n> (Chromium): CDP's CPU throttle, a phone-CPU proxy for frame-cost diagnostics (the shot is unchanged)
  if(throttle>1){if(!owner)throw Error('--cpu-throttle needs Chromium');await(await context.newCDPSession(page)).send('Emulation.setCPUThrottlingRate',{rate:throttle});}page.on('pageerror',e=>row.errors.push(e.message));
  // console warnings, each text once with its count (NR4: AttributeNode missing-channel warnings)
  page.on('console',m=>{if(m.type()!=='warning')return;const t=m.text().slice(0,300);row.warnings[t]=(row.warnings[t]??0)+1;});
  const inflight=new Map();page.on('request',r=>inflight.set(r,Date.now()));page.on('requestfinished',r=>inflight.delete(r));page.on('requestfailed',r=>inflight.delete(r));
  // what never arrived: a fallback path's first symptom
  row.failed=[];page.on('requestfailed',r=>row.failed.push(r.url()));page.on('response',r=>{if(r.status()>=400)row.failed.push(`${r.status()} ${r.url()}`);});
  const version=await(await page.request.get(new URL('/version.json',base).href)).json();
  const actual=goldenPreviewIdentity(version,arg('sha',''));
  if(actual.build!==source.build)throw Error(`Preview changed from ${source.build} to ${actual.build}`);row.build=actual.build;
  await page.goto(base,{waitUntil:'load'});
  if (slug==='nine-dragon-stack'&&nativeBinding!==null) {
    // The per-document DOM-ready hook also covers SHARD SELECT's fresh-page
    // navigation. The title's explicit handshake precedes every menu action.
    await page.evaluate(()=>{void window.__installGoldenResidency();});
    await page.waitForFunction(()=>window.__goldenResidency!==undefined||window.__goldenResidencyFailure!==undefined);
    const failure=await page.evaluate(()=>window.__goldenResidencyFailure);if(failure)throw new Error(failure);
    row.nativeBinding={...nativeBinding,installed:'per-document-dom-ready-before-world-entry'};
  }
  await page.locator('.ws-main-select').click();
  const names=await page.locator('.ws-menu-card b').allTextContents();
  await page.locator(`.ws-menu-dots i[data-i="${loadingCardIndex(names,slug)}"]`).click();
  // ENTER WORLD, the one entry (the shardfile, G531; QD7 LD5 removed the LEGACY / SHARDFILE pair)
  const button=page.locator('.ws-menu-play');
  if(await button.isDisabled())throw Error(`${mode} entry disabled`);await button.click();
  await page.waitForFunction(()=>!!window.__wildshard?.world?.hud?.entered&&!document.querySelector('.ws-load')&&window.__wildshard.world.game.frameGate(),undefined,{timeout:180000});
  if (slug==='nine-dragon-stack'&&nativeBinding!==null) {
    await page.waitForFunction(()=>window.__goldenResidency!==undefined||window.__goldenResidencyFailure!==undefined);
    const failure=await page.evaluate(()=>window.__goldenResidencyFailure);if(failure)throw new Error(failure);
  }
  if(await page.evaluate(()=>window.__wildshard.world.hud.paused))await(owner?pressEscape(endpoint,page.url()):page.keyboard.press('Escape'));
  row.entry=await page.evaluate(()=>({url:location.href,id:window.__wildshard.world.game.level.id}));
  const want=slug;if(row.entry.id!==want)throw Error(`Not ${mode}: ${row.entry.id}`);row.mode=mode;
  // the golden camera is a spectator: its player takes no damage (Pine's bear-den elite killed it, and the death fade put it
  // back at spawn with the ring and the grass field)
  await page.evaluate(()=>{const hp=window.__wildshard.world.game.app.player;if(hp)hp.attributes.incomingCap=0;});
  for(let i=0;i<canonical[slug].length;i++){
   const c=canonical[slug][i];if(only&&!only.has(c.n??i+1))continue;
   const probe=c.probe??{x:c.feet?.[0]??c.eye[0],z:c.feet?.[2]??c.eye[2],yaw:-c.yaw*Math.PI/180,pitch:c.pitch*Math.PI/180,...c.feet?{y:c.feet[1]}:{}};
   if(c.spawnFallback)delete probe.y;
   // a free camera: the player hovers under the eye (its x / z, an eye height below), so ring and culling are the eye's
   const free=c.eye!==undefined&&Math.hypot(c.eye[0]-probe.x,c.eye[2]-probe.z,probe.y===undefined?0:c.eye[1]-EYE-probe.y)>FREE;
   const at=free?{...probe,x:c.eye[0],y:c.eye[1]-EYE,z:c.eye[2]}:probe;
   await page.evaluate(()=>{const w=window.__wildshard.world;w.game.hold=false;window.__wsEye=null;
    // what hangs off the camera before any hover (the held weapon, the hands): the shot keeps only these visible. Taken
    // once per entry: a board stepped off a moment ago still shows while it fades
    window.__wsCamOff??=new Set(w.game.camera.children.filter(o=>o.visible));});
   await board(page,false);await page.evaluate(p=>window.__wildshard.pose(p),at);if(free)await board(page,true);
   await frames(page,FRAMES);const idle=await settle(page,inflight);await frames(page,30);
   // a player on a slope slides off its pose while streaming settles (Pine's bear den slid into the lake and respawned at
   // spawn, so its eye became spawn's): an eye-height camera puts it back before its eye is read
   const drifted=!free&&await page.evaluate(p=>{const q=window.__wildshard.world.player.position;return Math.hypot(q.x-p.x,q.z-p.z)>2;},at);
   if(drifted){await page.evaluate(p=>window.__wildshard.pose(p),at);await frames(page,30);}
   // QF20: a probe without a height takes the ground under it at pose time. Posed before a structure's colliders stream in
   // (Driftwood's pier after the aerial cameras) the player stood under the deck (y -0.87 instead of 1.22) and its body
   // shadow fell under it; once streaming settles, such a probe is posed again on the ground now resident
   const sunk=!free&&!drifted&&at.y===undefined&&await page.evaluate(p=>{const before=window.__wildshard.world.player.position.y;return window.__wildshard.pose(p).then(()=>Math.abs(window.__wildshard.world.player.position.y-before)>0.5);},at);
   if(sunk)await frames(page,30);
   // the eye becomes the game camera: set in the late phase of every frame, so the next update culls and streams for it
   await page.evaluate(c=>{const w=window.__wildshard.world,g=w.game,cam=g.camera,settled=cam.position.toArray();
    window.__wsEye={eye:c.eye??[settled[0],settled[1]+(c.lift??0),settled[2]],pitch:c.pitch*Math.PI/180,yaw:-c.yaw*Math.PI/180,fov:c.fov,settled};
    if(window.__wsEyeHook!==g){window.__wsEyeHook=g;g.onLate(()=>{const e=window.__wsEye;if(e===null||e===undefined)return;
     cam.position.set(...e.eye);cam.rotation.set(e.pitch,e.yaw,0,'YXZ');cam.fov=e.fov;cam.updateProjectionMatrix();cam.updateMatrixWorld();},'golden.eye');}},c);
   // the eye is read: a sliding player now hovers where it stands, so it cannot slide off (and respawn) during the live frames
   if(drifted)await board(page,true);
   await frames(page,LIVE);const live=await settle(page,inflight);await frames(page,LIVE);
   if(ON_FOOT.has(slug)&&!await board(page,false))row.errors.push(`camera ${c.n}: still on the board`);
   const expResult=exp?await page.evaluate(code=>(new Function('w','g','return (async()=>{'+code+'})()'))(window.__wildshard.world,window.__wildshard.world.game),exp):undefined;
   let residency;
   if (slug==='nine-dragon-stack'&&nativeBinding!==null) {
    await page.evaluate(()=>{window.__wildshard.world.game.hold=true;});
    residency=await page.evaluate(heldGoldenResidency);
   }
   const observed=await page.evaluate(()=>{
    const w=window.__wildshard.world,g=w.game,e=window.__wsEye;g.hold=true;
    const player=w.player.position.toArray(),cam=g.camera;
    // a free camera's hovering player is not in the golden: what the board brought onto the camera (its first-person
    // deck) and the board model stay out of the shot, and are shown again after it
    const off=window.__wsCamOff??new Set();window.__wsBoards=[];
    for(const o of cam.children)if(o.visible&&!off.has(o)){o.visible=false;window.__wsBoards.push(o);}
    g.scene.traverse(o=>{if(o.name==='hoverboard'&&o.visible){o.visible=false;window.__wsBoards.push(o);}});
    cam.position.set(...e.eye);cam.rotation.set(e.pitch,e.yaw,0,'YXZ');cam.fov=e.fov;cam.updateProjectionMatrix();cam.updateMatrixWorld();// QF20: two frames at the held camera; one left SHARDFILE's shadow-layer casters (the body shadow) out
    g.shardFrame();g.composer.render(0);g.shardFrame();g.composer.render(0);
    return{eye:cam.position.toArray(),rotation:cam.rotation.toArray(),fov:cam.fov,frame:g.frameCount,player,hover:w.player.hover===true,settledEye:e.settled};
   });
   const shot=set?`${dir}/${String(c.n).padStart(2,'0')}-${c.name}-${mode}.png`:`${dir}/${i+1}-${c.name}-shardfile.png`;
   // the 24-camera set hides the HUD (every element but the canvases; a canvas read-back misses Nine's layered composite)
   // and the minimap: a canvas smaller than half the viewport stays hidden
   if(set){await page.evaluate(()=>{for(const el of document.querySelectorAll('canvas')){const r=el.getBoundingClientRect();el.dataset.wsShot=r.width*r.height>=innerWidth*innerHeight/2?'1':'0';}});
    const hide=await page.addStyleTag({content:'body *{visibility:hidden!important}canvas[data-ws-shot="1"]{visibility:visible!important}'});
    await page.screenshot({path:shot,type:'png',scale:'device'});await hide.evaluate(e=>e.remove());}
   else await page.screenshot({path:shot,type:'png',scale:'css'});
   await page.evaluate(()=>{for(const o of window.__wsBoards??[])o.visible=true;window.__wsBoards=[];});
   row.poses.push({n:c.n??i+1,name:c.name,free,drifted,sunk,idle,live,residency,...observed,...(exp?{exp:expResult}:{}),shot});
   writeFileSync(`${root}/receipts-${slug}.json`,JSON.stringify(row,null,1));
  }
  row.status=row.errors.length===0?'complete':'errors';
 }catch(error){row.status='failed';row.failure=String(error);if(page)await page.screenshot({path:`${dir}/failure.jpg`,type:'jpeg',quality:80,scale:'css'}).catch(()=>{});}
 finally{rows.push(row);writeFileSync(`${root}/receipts.json`,JSON.stringify(rows,null,2));await context.close();
  console.log(JSON.stringify({slug,status:row.status,poses:row.poses.length,idle:row.poses.map(p=>p.idle.settled),failure:row.failure,errors:row.errors.slice(0,3),warnings:Object.values(row.warnings).reduce((n,c)=>n+c,0)}));}
 if(row.status==='failed')process.exitCode=1;
}}finally{try{await browser.close();}finally{await owner?.close();}}
