#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { shardFolders } from './shard-folders.mjs';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { developerSettings, hideDeveloperOverlays } from './debug-settings.mjs';
import { installInit } from './parity/init.mjs';
import { cachedTree, exportTree, readJson, serve } from './parity/serve.mjs';
import { evictBuildCache } from './parity/cache.mjs';
import { captureIgnore, compare, matches, normalize } from './parity/compare.mjs';
import { compareOffline, failureReasons } from './parity/offline.mjs';
import { assertMetal, relevantError } from './parity/fingerprint.mjs';
import { poses } from './parity/poses.mjs';
import { walk } from './parity/walk.mjs';
import { combat, pauseResume } from './parity/combat.mjs';
import { acceptFields, aggregate, imageScore, writeBaseline } from './parity/record.mjs';
import { array, flatten, get, object, string } from './parity/value.mjs';
import { within } from './parity/timeout.mjs';
import { advance } from './parity/frames.mjs';
import { browserPool, parallel } from './parity/pool.mjs';
import { fastSelection, nextRotation } from './parity/profile.mjs';
import { budgetLines, budgetViews } from './parity/budgets.mjs';
import { waitForToastIdle } from './parity/hud.mjs';
import { telemetryFixtureAccepts } from './parity/telemetry.mjs';
import { sampleAudioBoundary, rememberAudioBoundary, publishAudioDiagnostics } from './parity/audio-diagnostics.mjs';
import { buildMutedGraph, settleAudio } from './parity/audio-settle.mjs';

/** @typedef {import('./parity/value.mjs').RecordValue} RecordValue */
const ROOT=resolve(import.meta.dirname,'..');
const HELP=`parity — structural, visual and gameplay parity (E357 03 §§1–12)
node scripts/parity.mjs --export=<full sha>|--url=<origin>
  --lane=m5|gh-macos15 --shards=all|a,b --tiers=phone,desktop
  --record --runs=3 --rebaseline=<slug> --accept=<ids> --pending-fill=<ids>
  --pending=<file> --retry=1 --plant=<id> --prove --only=green|<plant>|fingerprint+poses|walk+combat+leak
  --fast --jobs=N --changed=<paths> --base=<sha> --clock=fast|raf --cache-keep=N (default 3)
  --offline --full --ms --angle=metal --out=<dir> --timeout=240
Exits: 0 green; 1 regression; 2 usage; 3 infrastructure. Timing is information.
Every Mac run enters scripts/browser-lane.sh; builds are exported and served by vite preview.`;

/** @param {string[]} argv */
function parse(argv) {
  const flags=new Set(['record','prove','offline','full','ms','help','fast']),values=new Set(['export','url','lane','shards','tiers','runs','rebaseline','accept','pending-fill','pending','retry','plant','only','angle','out','timeout','jobs','changed','base','clock','cache-keep']);
  /** @type {Record<string,string|undefined>} */ const opts={};
  for(let i=0;i<argv.length;i++){const arg=i<argv.length?argv[i]:'',m=/^--([^=]+)(?:=(.*))?$/.exec(arg);if(!m)throw new Error(`usage: unknown argument ${arg}`);const key=m.length>1?m[1]:'';if(flags.has(key)){if(m.length>2 && typeof m[2]==='string')throw new Error(`usage: --${key} has no value`);opts[key]='true';}else if(values.has(key)){const val=typeof m[2]==='string'?m[2]:argv[++i];if(!val || val.startsWith('--'))throw new Error(`usage: --${key} needs a value`);opts[key]=val;}else throw new Error(`usage: unknown option --${key}`);}
  return opts;
}
/** @param {string} sha @param {string} shard */
function lanePending(sha,shard) {
  const lock=object(gitJson(`${sha}:.github/lock.json`));
  if(!Object.hasOwn(object(lock.reopened),shard))return false;
  const base=execFileSync('git',['log','-1','--format=%H',sha,'--',`test/parity/baselines/m5/${shard}.*`],{cwd:ROOT,encoding:'utf8'}).trim() || execFileSync('git',['log','-1','--format=%H',sha,'--','.github/lock.json'],{cwd:ROOT,encoding:'utf8'}).trim();
  if(!base)return false;
  const paths=[`src/shards/${shard}`,`test/shards/${shard}`,`scripts/blender/${shard}`,`public/assets/${shard}`,`public/assets/gpu/${shard}`,`public/assets/baked/${shard}`,`public/assets/gpu/baked/${shard}`,`public/assets/music/${shard}`,`public/assets/sfx/${shard}`,`public/assets/horizon/${shard}-*`,`public/assets/gpu/horizon/${shard}-*`,`public/assets/lut/${shard}.bin`,`public/assets/title/${shard}-portrait.jpg`,...array(object(lock.reopened)[shard]).map(string).filter((p)=>!p.startsWith('docs/')&&!p.startsWith('art/')&&!p.startsWith('test/parity/baselines/'))].map((p)=>`:(glob)${p.endsWith('**')||p.includes('*')||p.includes('.')?p:`${p}/**`}`);
  const log=execFileSync('git',['log','--format=%B%x00',`${base}..${sha}`,'--',...paths],{cwd:ROOT,encoding:'utf8'});
  return log.split('\0').some((m)=>m.trim() && !/^E357-Lead: yes$/m.test(m));
}
/** @param {string} ref @returns {unknown} */
function gitJson(ref){try{return JSON.parse(execFileSync('git',['show',ref],{cwd:ROOT,encoding:'utf8',stdio:['ignore','pipe','ignore']}));}catch{return undefined;}}
/** @param {RecordValue[]} reports @param {string} sha @param {string} out @param {boolean} ms */
function report(reports,sha,out,ms) {
  const lines=[`# Parity ${sha}`, '',`Verdict: ${reports.some((r)=>r.verdict==='red')?'red':'green'}`, ''];
  for(const r of reports){lines.push(`## ${string(get(r,'boot.shard'))} × ${string(get(r,'boot.tier'))}`,'',`Verdict: ${string(r.verdict)}${r.flaked?` · flaked ${JSON.stringify(r.flaked)}`:''}`,'','| Field | Baseline | Now | Band | Verdict |','|---|---|---|---|---|');for(const v of array(r.fields)){const row=object(v);if(!ms&&row.class==='C')continue;const show=/** @param {unknown} val */(val)=>JSON.stringify(val??null).replaceAll('|',String.raw`\|`).slice(0,600);lines.push(`| ${string(row.field)} | ${show(row.baseline)} | ${show(row.now)} | ${string(row.band)} | ${string(row.verdict)} |`);}lines.push('');}
  for (const r of reports) lines.push(`## Budget derivation ${string(get(r, 'boot.shard'))} × ${string(get(r, 'boot.tier'))}`, '', ...budgetLines(r));
  writeFileSync(join(out,'report.md'),`${lines.join('\n')}\n`);
}
/** @param {import('playwright').Browser} browser @param {string} url @param {{shard:string,tier:string,lane:string,sha:string,root:string,out:string,timeout:number,full:boolean,only:string|undefined,offline:boolean,fast?:boolean,accelerated?:boolean,telemetryFixture?:boolean,settings?:Record<string,string>}} opts */
export async function capture(browser,url,opts) {
  let offlineStep='install';
  const phaseStart=performance.now(),phases=/** @type {Record<string,number>} */({});let phase=phaseStart;
  const mark=(/** @type {string} */ name)=>{const now=performance.now();phases[name]=now-phase;phase=now;};
  console.error(`parity: ${opts.shard}.${opts.tier} boot`);
  const context=await browser.newContext(opts.tier==='phone'?{viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,serviceWorkers:opts.offline?'allow':'block'}:{viewport:{width:1600,height:900},deviceScaleFactor:1,serviceWorkers:opts.offline?'allow':'block'});
  try {
    if(opts.telemetryFixture){phases.telemetryFixturePosts=0;await context.route('**/api/telemetry',async(route)=>{
      const request=route.request(); let payload=/** @type {unknown} */(null);
      try{payload=request.postDataJSON();}catch{/* malformed POST remains an observed server error */}
      if(telemetryFixtureAccepts(request.method(),payload)){phases.telemetryFixturePosts++;await route.fulfill({status:200,json:{id:'parity-clock-proof'}});}
      else await route.continue();
    });}
    await installInit(context,{lane:opts.lane,sha:opts.sha,browser:browser.version(),capture:30,accelerated:opts.accelerated,tier:opts.tier});await developerSettings(context,{time:'midday',weather:'clear',...opts.settings});
    await context.addInitScript(hideDeveloperOverlays);
    const page=await context.newPage();page.setDefaultTimeout(opts.timeout*1000);
    page.on('response',(response)=>{if(response.status()>=400)console.error(`parity: ${opts.shard}.${opts.tier} HTTP ${response.status()} ${response.url()}`);});
    /** @type {string[]} */const errors=[];page.on('pageerror',(e)=>{if(relevantError(e.message))errors.push(e.message);});page.on('console',(m)=>{if(m.type()==='error'&&relevantError(m.text()))errors.push(m.text());});
    const params=new URLSearchParams({chunk:opts.shard,tier:opts.tier,skipintro:'1',nolock:'1',mute:'1',weather:'clear',...opts.tier==='phone'?{touch:'1'}:{},...opts.offline?{}:{sw:'0'}});
    if(opts.offline){
      const title=new URL(url);title.searchParams.set('chunk',opts.shard);title.searchParams.set('tier',opts.tier);if(opts.tier==='phone')title.searchParams.set('touch','1');await page.goto(title.toString());await page.waitForFunction(()=>Boolean(window.__wildshard)&&!document.querySelector('.ws-load'));await page.waitForFunction(async()=>Boolean(navigator.serviceWorker.controller)&&(await navigator.serviceWorker.ready).active?.state==='activated');await context.setOffline(true);offlineStep='title';await page.reload();await page.locator('.ws-menu-play').waitFor({state:'visible'});offlineStep='play';
    }
    await page.goto(`${url}/?${params}`);
    await page.waitForFunction(()=>Boolean(window.__wildshard) || Boolean(window.__wildshardHarness?.errors?.length) || Boolean(document.querySelector('.ws-load-error')),undefined,{timeout:opts.timeout*1000}).catch((/** @type {unknown} */ e)=> {if(errors.length === 0)throw e;});
    const loadFailure=await page.evaluate(()=>document.querySelector('.ws-load-error')?.textContent ?? '');
    if(loadFailure){errors.push(loadFailure);await page.screenshot({path:join(opts.out,`${opts.shard}.${opts.tier}.load-error.jpg`),type:'jpeg',quality:86});}
    const boot=await page.evaluate(()=>Object.hasOwn(window,'__wildshard') ? window.__wildshard.boot : undefined).catch(()=>undefined);
    if(!boot)return {boot:{shard:opts.shard,tier:opts.tier,lane:opts.lane,errors:errors.length > 0?errors:['boot did not install probe'],renderer:'ANGLE (Apple, ANGLE Metal Renderer',scene:{totals:{batched:0}}}};
    boot.errors=[...new Set([...boot.errors,...errors])];
    /** @type {RecordValue} */const result={boot:object(boot)};
    const observeAudio = async(/** @type {string} */ boundary) => {
      try { rememberAudioBoundary(result,boundary,await page.evaluate(sampleAudioBoundary)); }
      catch(error) { rememberAudioBoundary(result,boundary,{unavailable:(error instanceof Error?error.message:String(error)).slice(0,200)}); }
    };
    if(errors.length > 0)return result;
    await page.waitForFunction(()=>!document.querySelector('.ws-load') && !document.getElementById('hud')?.classList.contains('intro'));
    // G325 keeps the AudioContext for the player's first gesture; until 310110541 `?mute` built the muted graph during load
    // (`audio.master.disconnect()`), and every walk/combat sound baseline was recorded with it. Build it the same way here,
    // as the world appears, so sampled cues, beds and loops are recorded instead of their not-ready fallbacks.
    if(opts.only!=='fingerprint+poses')await buildMutedGraph(page);
    boot.hud=await within(page.evaluate(waitForToastIdle,opts.tier==='desktop'?60:30),11_000,'startup toast idle');
    const clockWitness=await page.evaluate(()=>{
      const clock=window.__wildshard.requireWorld().game.sky.dayNight;
      return {developer:Object.hasOwn(document.documentElement.dataset,'dev'),overlayStyle:Boolean(document.getElementById('parity-developer-overlays')),fpsBadges:[...document.querySelectorAll('.ws-perf,.ws-perf-panel')].map((node)=>getComputedStyle(node).visibility),clock:clock?{paused:clock.paused,phase:clock.phase}:null,developerAlerts:[...document.querySelectorAll('.ws-game-dev-alert')].filter((node)=>node instanceof HTMLElement&&!node.hidden).map((node)=>node.textContent||'Developer script failure')};
    });
    if(clockWitness.developerAlerts.length>0){object(result.boot).errors=[...new Set([...boot.errors,...clockWitness.developerAlerts])];return result;}
    if(!clockWitness.overlayStyle||clockWitness.fpsBadges.some((visibility)=>visibility!=='hidden'))throw new Error('Parity Developer overlays are visible');
    if(!clockWitness.developer)throw new Error('Parity Developer settings are inactive');
    if((opts.settings?.time??'midday')!=='live'&&clockWitness.clock&&!clockWitness.clock.paused)throw new Error('Parity requested frozen time but the live clock is running');
    writeFileSync(join(opts.out,`${opts.shard}.${opts.tier}.settings.json`),JSON.stringify({requested:{time:'midday',weather:'clear',...opts.settings},...clockWitness},null,2));
    if(opts.settings){
      const saved=object(await page.evaluate(()=>JSON.parse(localStorage.getItem('wildshard.save.v2@1.global')??'{}')));
      const observed=object(get(saved,'keys.settings.data'));
      if(Object.entries(opts.settings).some(([key,value])=>observed[key]!==value))throw new Error('Debug setting fixture did not survive boot');
      result.debugSettings=Object.fromEntries(Object.keys(opts.settings).map((key)=>[key,observed[key]]));
    }
    mark('bootMs');
    await observeAudio('boot');
    if(opts.offline){offlineStep='explore';await page.evaluate(()=>window.__wildshard.requireWorld().hud.startExplore());await page.locator('.ws-x').waitFor({state:'visible'});result.offline={title:true,play:true,explore:true};object(result.boot).errors=[...new Set([...boot.errors,...errors])];return result;}
    if(opts.only!=='walk+combat+leak'){console.error(`parity: ${opts.shard}.${opts.tier} poses`);result.poses=await within(poses(page,opts),opts.timeout*1000,'poses');mark('posesMs');}
    const hasBudgets=await page.evaluate(()=>Object.hasOwn(window.__wildshard,'budgets'));
    const extra=opts.only==='walk+combat+leak'||!hasBudgets?{}:await budgetViews(page, Array.isArray(result.poses) && result.poses.length === 0);
    result.budgets=object(await page.evaluate((names)=>{const p=/** @type {{budgets?:typeof window.__wildshard.budgets}} */(window.__wildshard);return p.budgets?.(names)??{};}, [...Array.isArray(result.poses) ? result.poses.map((p)=>string(object(p).name)) : [], ...Object.keys(extra)]));
    for(const [name,observed] of Object.entries(extra))object(object(result.budgets)[name]).observed=object(observed);
    writeFileSync(join(opts.out,`${opts.shard}.${opts.tier}.partial.json`),JSON.stringify(result,null,2));
    if(opts.only!=='fingerprint+poses') {
      // Those baselines also had the beds started and the deferred phone bank landed before the walk: settle the level's
      // audio so none of it straddles the walk's sound reset (sp-o97).
      phases.audioSettleFrames=await settleAudio(page);
      await observeAudio('before-walk');
      console.error(`parity: ${opts.shard}.${opts.tier} walk`);result.walk=object(await walk(page,opts));mark('walkMs');
      await observeAudio('after-walk');
      writeFileSync(join(opts.out,`${opts.shard}.${opts.tier}.partial.json`),JSON.stringify(result,null,2));
      console.error(`parity: ${opts.shard}.${opts.tier} combat`);result.combat=await within(combat(page,opts),opts.timeout*1000,'combat');mark('combatMs');
      await observeAudio('after-combat');
      console.error(`parity: ${opts.shard}.${opts.tier} pause/resume`);result.pauseResume=object(await within(pauseResume(page,opts.tier),opts.timeout*1000,'pause/resume'));mark('pauseResumeMs');
      result.leak=object(await page.evaluate(()=>window.__wildshard.leak()));mark('leakMs');
    }
    const session=await context.newCDPSession(page);await session.send('Performance.enable');const metrics=await session.send('Performance.getMetrics');object(result.boot).heapMB=(metrics.metrics.find((m)=>m.name==='JSHeapUsedSize')?.value??0)/2**20;await session.detach();
    const developerAlerts=await page.evaluate(()=>[...document.querySelectorAll('.ws-game-dev-alert')].filter((node)=>node instanceof HTMLElement&&!node.hidden).map((node)=>node.textContent||'Developer script failure'));
    object(result.boot).errors=[...new Set([...boot.errors,...errors,...developerAlerts])];
    return result;
  } catch(error) {
    if(opts.offline)throw new Error(`offline: ${opts.shard}.${opts.tier} ${offlineStep}: ${error instanceof Error?error.message:String(error)}`,{cause:error});
    throw error;
  } finally {await context.close();phases.totalMs=performance.now()-phaseStart;writeFileSync(join(opts.out,`${opts.shard}.${opts.tier}.phases.json`),JSON.stringify(phases,null,2));}
}

/** Fresh weather context for the F8 unload proof (03 §5.5).
 * @param {import('playwright').Browser} browser @param {string} url
 * @param {{shard:string,tier:string,lane:string,sha:string,timeout:number,accelerated?:boolean,settings?:Record<string,string>}} opts */
export async function weatherLeak(browser,url,opts) {
  const context=await browser.newContext(opts.tier==='phone'?{viewport:{width:390,height:844},deviceScaleFactor:3,isMobile:true,hasTouch:true,serviceWorkers:'block'}:{viewport:{width:1600,height:900},serviceWorkers:'block'});
  try {
    await installInit(context,{lane:opts.lane,sha:opts.sha,browser:browser.version(),capture:30,accelerated:opts.accelerated,tier:opts.tier});
    await developerSettings(context,{time:'midday',weather:opts.shard==='pine-hollow'?'rain':'clear',...opts.settings});
    const page=await context.newPage();
    /** @type {string[]} */ const errors=[];
    page.on('pageerror',(error)=>{if(relevantError(error.message))errors.push(error.message);});
    page.on('console',(message)=>{if(message.type()==='error'&&relevantError(message.text()))errors.push(message.text());});
    const params=new URLSearchParams({chunk:opts.shard,tier:opts.tier,skipintro:'1',nolock:'1',mute:'1',sw:'0',weather:opts.shard==='nalati-grasslands'?'storm':'rain',...opts.tier==='phone'?{touch:'1'}:{}});
    await page.goto(`${url}/?${params}`);
    await page.waitForFunction(()=>Boolean(window.__wildshard)&&!document.querySelector('.ws-load'),undefined,{timeout:opts.timeout*1000});
    const available=await page.evaluate(()=>Object.hasOwn(window.__wildshard,'leak'));
    if(!available)return {before:{ready:true},after:{ready:false}};
    console.error(`parity: ${opts.shard}.${opts.tier} weather leak`);
    await advance(page,900);
    const result=object(await page.evaluate(()=>{
      const p=/** @type {{leak:()=>Promise<unknown>}} */(window.__wildshard);
      return p.leak();
    }));
    object(result.before).errors=[];object(result.after).errors=[...new Set(errors)];return result;
  }finally{await context.close();}
}

/** @param {Record<string,string|undefined>} opts */
async function main(opts) {
  if(opts.help){console.log(HELP);return 0;}
  if(Boolean(opts.export)===Boolean(opts.url))throw new Error('usage: provide exactly one --export=<full sha> or --url=<origin>');
  if(opts.export && !/^[0-9a-f]{40}$/.test(opts.export))throw new Error('usage: --export requires a full captured SHA, never HEAD');
  const lane=opts.lane??'m5';if(!['m5','gh-macos15'].includes(lane))throw new Error('usage: unknown lane');
  const tiers=(opts.fast?'phone':opts.tiers??'phone').split(',');if(tiers.some((t)=>!['phone','desktop'].includes(t)))throw new Error('usage: unknown tier');
  const modes=['record','rebaseline','accept','pending-fill','prove','offline'].filter((k)=>opts[k]);if(modes.length>1)throw new Error('usage: modes are mutually exclusive');
  if((opts.prove||opts.plant) && !opts.export)throw new Error('usage: --prove and --plant require --export');
  if((opts.accept||opts['pending-fill']||opts.rebaseline) && lane!=='m5')throw new Error('usage: baseline changes require m5');
  if(opts.angle && opts.angle!=='metal' && !(opts.plant==='metal-off'||opts.only==='metal-off'))throw new Error('usage: only metal-off may change ANGLE');
  const runs=Number(opts.accept||opts.rebaseline?3:opts.runs??(opts.record?3:1)),retry=Number(opts.retry??1),timeout=Number(opts.timeout??240);
  if(!Number.isInteger(runs)||runs<1||!Number.isFinite(timeout)||timeout<=0||![0,1].includes(retry))throw new Error('usage: invalid runs/retry/timeout');
  if(opts.clock&&!['fast','accelerated','raf'].includes(opts.clock))throw new Error('usage: --clock must be fast or raf');
  if(opts.fast&&(modes.length>0||opts.full||opts.plant||opts.only))throw new Error('usage: --fast is compare only, with gate routes and reduced poses');
  const available=process.platform==='darwin'?Number(execFileSync(join(ROOT,'scripts/browser-lane.sh'),['capacity'],{encoding:'utf8'}).trim().split(' ')[1]):1;
  const jobs=Number(opts.jobs??Math.max(1,Math.min(8,available)));
  if(!Number.isInteger(jobs)||jobs<1||jobs>8)throw new Error('usage: --jobs must be 1..8');
  const accelerated=opts.clock!=='raf',timings=/** @type {Record<string,number|string|boolean>} */({jobs,clock:accelerated?'accelerated':'raf'}),started=performance.now();
  // --url: the build's version.json carries `build` = `<sha7>-<time>` (no full sha): the job's SHA env wins, else the sha7
  // is resolved in this checkout (E357 F3.2: every runner record exited 3 here).
  const versionSha=async()=>{const v=object(await (await fetch(`${opts.url}/version.json`)).json());const full=string(v.sha);if(full)return full;
    if(process.env.SHA&&/^[0-9a-f]{40}$/.test(process.env.SHA))return process.env.SHA;
    const short=/^([0-9a-f]{7,})-/.exec(string(v.build))?.[1];if(!short)return '';try{return execFileSync('git',['rev-parse',short],{cwd:ROOT,encoding:'utf8'}).trim();}catch{return '';}};
  const sha=opts.export??await versionSha();
  if(!sha)throw new Error('infrastructure: version.json has no sha');
  const out=resolve(opts.out??join(ROOT,'progress/parity',sha.slice(0,7)));mkdirSync(out,{recursive:true});
  const cacheKeep=Number(opts['cache-keep']??3);
  if(!Number.isInteger(cacheKeep)||cacheKeep<1)throw new Error('usage: --cache-keep must be a positive integer');
  const buildStart=performance.now();
  const exported=opts.export?(opts.plant?exportTree(ROOT,sha):await cachedTree(ROOT,sha)):null,root=exported?.tree??ROOT;
  const fixtureRoot=exported&&'fixtures' in exported&&typeof exported.fixtures==='string'?exported.fixtures:root;
  timings.buildMs=performance.now()-buildStart;timings.cacheHit=Boolean(exported&&'hit' in exported&&exported.hit);
  let preview=/** @type {{url:string,close:()=>void}|null} */(null);const pool=browserPool(ROOT,jobs,opts.angle??'metal');
  try {
    if(exported&&'hit' in exported)timings.cacheEvicted=evictBuildCache(undefined,cacheKeep).length;
    const plants=array(readJson(join(fixtureRoot,'test/parity/plants/index.json'))).map(object);
    // X22 (G416): the frozen -legacy copies are the ruler's comparison source, never edited and no longer booted against
    // today's shared code (boot-smoke already leaves them out); parity gates the shipped shards only
    const registry=shardFolders(root).filter((slug)=>!slug.endsWith('-legacy'));if(registry.length===0)throw new Error('empty shard registry');
    let shards=opts.shards&&opts.shards!=='all'?opts.shards.split(','):registry;if(shards.some((s)=>!registry.includes(s)))throw new Error('usage: unknown shard');
    if(opts.fast){
      const base=opts.base??execFileSync('git',['merge-base','origin/main',sha],{cwd:ROOT,encoding:'utf8'}).trim();
      const changed=opts.changed?opts.changed.split(','):execFileSync('git',['diff','--name-only',base,sha],{cwd:ROOT,encoding:'utf8'}).trim().split('\n');
      const selectedFast=fastSelection(root,shards,changed,nextRotation());shards=selectedFast.map((r)=>r.shard);
      for(const row of selectedFast)console.error(`parity: --fast ${row.shard}: ${row.reason}`);
      writeFileSync(join(out,'selection.json'),JSON.stringify({base,changed,selected:selectedFast},null,2));
    }
    if(opts.rebaseline && !registry.includes(opts.rebaseline))throw new Error('usage: unknown rebaseline shard');
    if(opts.prove){
      for(const shard of shards)for(const tier of tiers)if(!existsSync(join(fixtureRoot,`test/parity/baselines/${lane}/${shard}.${tier}.json`))) {writeFileSync(join(out,'report.md'),`# Proof failed\n\nMissing baseline: ${shard}.${tier}\n`);return 1;}
      const parts=opts.only?[opts.only]:['green',...plants.filter((p)=>['patch','flag'].includes(string(p.kind))).map((p)=>string(p.id))];
      for(const part of parts){const plant=plants.find((p)=>p.id===part);if(part!=='green'&&!plant)throw new Error(`usage: unknown proof part ${part}`);const affected=plant?.shards==='all'?shards:plant?shards.filter((s)=>array(plant.shards).includes(s)):shards;if(affected.length === 0)continue;
        for(let n=0;n<(part==='green'?2:1);n++){const childArgs=process.argv.slice(2).filter((a)=>!a.startsWith('--prove')&&!a.startsWith('--only')&&!a.startsWith('--out')&&!a.startsWith('--shards')&&!a.startsWith('--retry'));const plantArgs=plant?[`--plant=${part}`,...plant.flag?[string(plant.flag)]:[]]:[];const run=spawnSync(process.execPath,[import.meta.filename,...childArgs,...plantArgs,`--shards=${affected.join(',')}`,`--retry=0`,`--out=${join(out,`${part}-${n}`)}`],{stdio:'inherit',env:{...process.env,PARITY_IN_LANE:'1'}});
          if(part==='green'&&run.status!==0 || plant?.expect==='exit3'&&run.status!==3 || plant&&plant.expect!=='exit3'&&run.status!==1)return 1;
          if(plant&&plant.expect!=='exit3'){const reds=affected.flatMap((s)=>tiers.flatMap((t)=>array(object(readJson(join(out,`${part}-${n}`,`${s}.${t}.json`))).fields).map(object).filter((r)=>r.verdict==='red').map((r)=>string(r.field))));for(const expected of array(plant.expect))if(!reds.some((p)=>matches(string(expected),p)))return 1;}
        }
      }
      writeFileSync(join(out,'report.md'),'# Determinism proof\n\nVerdict: green\n');return 0;
    }
    if(opts.plant){const plant=plants.find((p)=>p.id===opts.plant);if(!plant)throw new Error('usage: unknown plant');if(plant.kind==='patch')execFileSync('git',['apply',join(fixtureRoot,'test/parity/plants',string(plant.patch))],{cwd:root});else if(plant.kind==='flag')opts.angle=string(plant.flag).split('=')[1]??'metal';else throw new Error('usage: nightly/linux plants use their own runner');}
    if(exported)preview=await serve(root,sha,'hit' in exported);
    const url=preview?.url??opts.url??'';
    const pendingPath=resolve(opts.pending??join(ROOT,'project/archive/game-normalization/reviews/pending.json'));
    const pending=array(opts.pending?readJson(pendingPath):opts.export?gitJson(`${sha}:project/archive/game-normalization/reviews/pending.json`):readJson(pendingPath)).map(object);
    const quarantine=array(readJson(join(fixtureRoot,'test/parity/quarantine.json'))).map(object),renameDir=join(fixtureRoot,'test/parity/renames');
    const renames=existsSync(renameDir)?readdirSync(renameDir).sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})).map((p)=>object(readJson(join(renameDir,p)))):[];
    const ambientInfo=array(readJson(join(fixtureRoot,'test/parity/ambient-info.json'))).map(string);
    const ids=(opts.accept??opts['pending-fill']??'').split(','),selected=pending.filter((p)=>ids.includes(string(p.id)));
    if((opts.accept||opts['pending-fill']) && selected.length!==ids.length)throw new Error('usage: unknown pending ids');
    const runShards=opts.rebaseline || opts['pending-fill'] ? registry : shards,runTiers=opts.rebaseline||opts.accept||opts['pending-fill']?['phone','desktop']:tiers;
    /** @type {RecordValue[]} */const reports=[];
    /** @type {{shard:string,tier:string,baseline:RecordValue,fields:string[]|undefined}[]} */const writes=[];
    const pairs=runShards.flatMap((shard)=>runTiers.filter((tier)=>!(opts['pending-fill']&&tier==='desktop'&&!selected.some((p)=>p.shard===shard))).map((tier)=>({shard,tier,
      isRecord:Boolean(opts.record)||opts.rebaseline===shard||Boolean(opts.accept)&&selected.some((p)=>p.shard===shard)})));
    const tasks=pairs.flatMap((pair,index)=>Array.from({length:pair.isRecord?runs:1},(_,n)=>({...pair,index,n})));
    const captures=await parallel(tasks,jobs,async(task,_,slot)=>{
      const browser=await pool.browser(slot);await assertMetal(browser,opts.angle??'metal');
      const dir=join(out,`run-${task.n+1}`);mkdirSync(dir,{recursive:true});const begin=performance.now();
      const captured=object(await capture(browser,url,{shard:task.shard,tier:task.tier,lane,sha,root,out:dir,timeout,full:Boolean(opts.full),only:opts.only,offline:Boolean(opts.offline),fast:Boolean(opts.fast),accelerated}));
      if(captured.leak&&['pine-hollow','nalati-grasslands'].includes(task.shard))object(captured.leak).weather=object(await weatherLeak(browser,url,{...task,lane,sha,timeout,accelerated}));
      timings[`${task.shard}.${task.tier}.run${task.n+1}Ms`]=performance.now()-begin;
      writeFileSync(join(dir,`${task.shard}.${task.tier}.raw.json`),JSON.stringify(captured,null,2));
      return {index:task.index,captured};
    },(slot)=>pool.release(slot));
    const browser=await pool.browser(0),scoreContext=await browser.newContext(),scorePage=await scoreContext.newPage();
    try {for(const [index,{shard,tier,isRecord}] of pairs.entries()){
      const rawRuns=captures.filter((r)=>r.index===index).map((r)=>r.captured);
      const audioRuns=[...rawRuns];
      const baselineFile=join(fixtureRoot,`test/parity/baselines/${lane}/${shard}.${tier}.json`),baseline=object(readJson(baselineFile));
      const current=isRecord?await aggregate(scorePage,rawRuns,{sha,browser:browser.version()}):rawRuns[0]??{};
      const ignore=captureIgnore(opts.only,Boolean(opts.fast));
      if(opts.fast)ignore.push(...Object.keys(object(normalize(baseline).poses)).filter((name)=>!Object.hasOwn(object(normalize(current).poses),name)).map((name)=>`poses.${name}`));
      if(opts.full)ignore.push(...Object.keys(object(get(normalize(current),'walk.legs'))).filter((name)=>get(normalize(baseline),`walk.legs.${name}`)===undefined).map((name)=>`walk.legs.${name}`));
      const fields=selected.filter((p)=>p.shard===shard).flatMap((p)=>array(p.fields).map(string));
      if(opts.accept||opts['pending-fill'])ignore.push(...fields);
      const options={pending,quarantine,renames,ambientInfo,lanePending:lane==='m5'&&opts.rebaseline!==shard&&Boolean(opts.export)&&lanePending(sha,shard),ignore};
      const baselineNormalized=normalize(baseline);let currentNormalized=normalize(current);
      /** @param {RecordValue} row */
      const scorePoses=async(row)=>{for(const [name,p]of Object.entries(object(row.poses))){const golden=join(fixtureRoot,`test/parity/baselines/${lane}/${shard}.${tier}.${name}.jpg`);if(existsSync(golden)){const score=await imageScore(scorePage,golden,string(object(p).shot),[.../** @type {number[][]} */(array(get(baselineNormalized,`poses.${name}.boxes`))),.../** @type {number[][]} */(array(object(p).boxes))]);object(p).ssim=score.ssim??0;if((score.ssim??0)<0.99&&score.diff)writeFileSync(join(out,`${shard}.${tier}.${name}.diff.png`),score.diff);}}};
      if(!opts.offline && (!isRecord || opts.accept))await scorePoses(currentNormalized);
      let checked=opts.offline?compareOffline(currentNormalized):compare(isRecord&&!opts.accept?{}:baseline,currentNormalized,options);
      if(isRecord&&!opts.accept)for(const r of rawRuns){const consistency=compare(current,normalize(r),{...options,renames:[],ignore:[...ignore,...Object.keys(flatten(current)).filter((p)=>p.endsWith('.ssim'))]});if(consistency.verdict==='red')checked=consistency;}
      if(isRecord&&opts.accept)for(const r of rawRuns){const normalized=normalize(r);await scorePoses(normalized);const consistency=compare(baseline,normalized,options);if(consistency.verdict==='red')checked=consistency;}
      if(!isRecord&&checked.verdict==='red'&&retry){const firstRed=checked.rows.filter((r)=>r.verdict==='red').map((r)=>r.field),dir=join(out,'retry');mkdirSync(dir,{recursive:true});const recaptured=object(await capture(browser,url,{shard,tier,lane,sha,root,out:dir,timeout,full:Boolean(opts.full),only:opts.only,offline:Boolean(opts.offline),fast:Boolean(opts.fast),accelerated}));audioRuns.push(recaptured);const again=normalize(recaptured);if(again.leak&&['pine-hollow','nalati-grasslands'].includes(shard)){const weather=await weatherLeak(browser,url,{shard,tier,lane,sha,timeout,accelerated});object(again.leak).weather=object(weather);}if(!opts.offline)await scorePoses(again);const retried=opts.offline?compareOffline(again):compare(baseline,again,options);checked=retried;currentNormalized=again;if(retried.verdict!=='red')currentNormalized.flaked=firstRed;}
      for(const reason of failureReasons(checked))console.error(`parity: ${shard}.${tier}${opts.offline?' offline':''} red: ${reason}`);
      currentNormalized.verdict=checked.verdict;currentNormalized.fields=checked.rows.map((r)=>object(r));reports.push(currentNormalized);
      for(const [name,p] of Object.entries(object(currentNormalized.poses)))if(existsSync(string(object(p).shot)))copyFileSync(string(object(p).shot),join(out,`${shard}.${tier}.${name}.jpg`));
      writeFileSync(join(out,`${shard}.${tier}.json`),`${JSON.stringify(currentNormalized,null,2)}\n`);report(reports,sha,out,Boolean(opts.ms));
      publishAudioDiagnostics(join(out,`${shard}.${tier}.audio-diagnostics.json`),audioRuns,checked.verdict==='red');
      if(isRecord)writes.push({shard,tier,baseline:opts.accept?acceptFields(baselineNormalized,current,fields):current,fields:opts.accept?fields:undefined});
      if(opts['pending-fill'])for(const entry of selected.filter((p)=>p.shard===shard)){if(array(entry.fields).every((p)=>string(p).startsWith('memory.')))continue;const expect=object(entry.expect);for(const field of array(entry.fields).map(string))for(const [path,val]of Object.entries(flatten(currentNormalized)))if(matches(field,path)&&val!==undefined)expect[`${tier}/${path}`]=val;entry.expect=expect;}
    }
    }finally{await scoreContext.close();}
    if(reports.some((r)=>r.verdict==='red'))return 1;
    for(const w of writes)writeBaseline(ROOT,lane,w.shard,w.tier,w.baseline,w.fields);
    if(opts.record){const dir=join(ROOT,'test/parity/baselines',lane);mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'meta.json'),`${JSON.stringify({harness:2,sha,recorded:new Date().toISOString(),browser:browser.version(),runnerImage:process.env.ImageVersion??'local'},null,2)}\n`);}
    if(opts.accept||opts.rebaseline){const changed=new Set(writes.map((w)=>w.shard)),dir=join(ROOT,'test/parity/baselines/gh-macos15');if(existsSync(dir))for(const file of readdirSync(dir))if([...changed].some((s)=>file.startsWith(`${s}.`)))rmSync(join(dir,file));}
    if(opts.accept||opts['pending-fill']){mkdirSync(dirname(pendingPath),{recursive:true});writeFileSync(pendingPath,`${JSON.stringify(opts.accept?pending.filter((p)=>!ids.includes(string(p.id))):pending,null,2)}\n`);}
    return 0;
  } finally {try{await pool.close();}finally{preview?.close();exported?.cleanup();timings.totalMs=performance.now()-started;writeFileSync(join(out,'timings.json'),JSON.stringify(timings,null,2));}}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)try {process.exitCode=await main(parse(process.argv.slice(2)));}catch(e){
  const msg=e instanceof Error?e.message:String(e),exitCode=msg.startsWith('usage:')?2:msg.startsWith('offline:')?1:3;
  console.error(msg);process.exitCode=exitCode;
  if(exitCode===3 || msg.startsWith('offline:')){const opts=parse(process.argv.slice(2)),sha=opts.export??'unknown',out=resolve(opts.out??join(ROOT,'progress/parity',sha.slice(0,7)));mkdirSync(out,{recursive:true});writeFileSync(join(out,'report.json'),`${JSON.stringify({exitCode,reason:msg})}\n`);writeFileSync(join(out,'report.md'),`# Parity ${exitCode===3?'infrastructure':'offline failure'}\n\n${msg}\n`);}
}
