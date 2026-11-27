#!/usr/bin/env node
// STANDALONE-SHARDFILES SF5 to SF9 (meta plan, J525): a zone's shardfile is all it needs. Cook one local tarball as
// production does, attach the cook to a fresh page build that bakes no copy of the zone, enter the zone headless on a
// desktop and a 402×874 phone, and refuse any request the page origin answers for the zone's art: every file the zone
// reads must come from its cook.
//
//   node src/scripts/zone-cook-entry.mjs --slug <slug> --tarball <file.shardfile> [--out tmp/zone-cook-entry]
//     [--reuse <work dir>]   skip the page build and the cook a kept run already made (its work dir)
//     [--keep]               keep the work dir (tree, build, cook) for --reuse
//     [--tiers desktop,phone] [--settle ms]
// The proof is `<out>/<slug>.json`: per tier, the gameplay time, every request by origin, and `zoneFromPage`, the page
// origin's answers for zone art. Exit 1 when either tier misses gameplay or `zoneFromPage` is not empty.
// Zone art on the page origin: a URL the tarball names or carries, a path naming the slug, or (once SF1's
// `src/scripts/public-engine.json` lands) any `/assets/` file off the engine list.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync,copyFileSync,cpSync,statSync} from 'node:fs';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {join,resolve as resolvePath} from 'node:path';
import {parseArgs} from 'node:util';
import {linkNodeModules} from './link-node-modules.mjs';
import {sourceBuildId} from './app-build/buildIdentity.mjs';
import {serve} from './parity/serve.mjs';
import {KEYCHAIN_ARGS} from './.kit/chromium-keychain.mjs';
import {admittedPlaywright} from './browser-machine-loader.mjs';
import {enterZone} from './zone-entry.mjs';
import {bootObservation} from './parity/boot-smoke.mjs';
import {isArt} from './public-verdicts.mjs';
import {NAME_ASKED,saveFixture} from './debug-settings.mjs';

const {values:o}=parseArgs({options:{slug:{type:'string'},tarball:{type:'string'},out:{type:'string',default:'tmp/zone-cook-entry'},
  reuse:{type:'string'},keep:{type:'boolean',default:false},tiers:{type:'string',default:'desktop,phone'},settle:{type:'string',default:'8000'},
  timeout:{type:'string',default:'240000'}}});
if(o.slug===undefined||o.tarball===undefined||!/^[a-z0-9-]+$/u.test(o.slug))throw new Error('usage: zone-cook-entry --slug <slug> --tarball <file> [--out dir] [--reuse dir] [--keep]');
await import('./bake-loader.mjs');
const {folderStore}=await import('../cook/game/packStore.ts');
const {objectHeaders}=await import('../cook/game/cookWorker.ts');
const {addStoredShards}=await import('./app-build/catalogue.ts');
const {readTar}=await import('@wildshard/format/tar');

const root=process.cwd(),slug=o.slug,out=resolvePath(o.out);mkdirSync(out,{recursive:true});
const tarball=readFileSync(resolvePath(o.tarball)),hash=createHash('sha256').update(tarball).digest('hex');
const work=o.reuse===undefined?mkdtempSync(join(out,'.run-')):resolvePath(o.reuse),tree=join(work,'tree'),cooked=join(work,`cooked-${hash.slice(0,12)}`),cache=join(work,'cache');
/** @param {string[]} args @param {NodeJS.ProcessEnv} [env] */
const node=(args,env=process.env)=>execFileSync(process.execPath,args,{cwd:tree,env,stdio:'inherit',timeout:900000});
/** @param {string} file */ const readJson=file=>JSON.parse(readFileSync(file,'utf8'));

// What the tarball names: its carried mounts and every /assets/ or /programs/ URL in its text files.
const files=readTar(tarball),named=new Set(),ASSET=/\/(?:assets|programs)\/[A-Za-z0-9_\-./]+\.[a-z0-9]+/gu;
for(const [path,body] of files){
  const mounted=/^mounts\/((?:assets|programs)\/.+)$/u.exec(path)?.[1];
  if(mounted!==undefined)named.add(`/${mounted}`);
  if(path.startsWith('blobs/')&&!path.startsWith('blobs/json/'))continue;
  for(const match of new TextDecoder().decode(body).matchAll(ASSET))named.add(match[0]);
}
const cookJson=files.get('cook.json');
if(cookJson!==undefined)for(const row of JSON.parse(new TextDecoder().decode(cookJson)).mounts??[])named.add(row.url);
const engineList=existsSync(join(root,'src/scripts/public-engine.json'))?new Set(readJson(join(root,'src/scripts/public-engine.json')).files??[]):undefined;
/** Zone art the page origin answered: a file of the engine's public/ (the build fingerprints some, `-<hash16>`) that the
 *  zone names, whose path names the zone, or that SF1's engine list leaves out. The title screen's art is the page's own.
 *  @param {string} path */
const zoneArt=path=>{
  const file=path.replace(/-[0-9a-f]{16}(\.[a-z0-9]+)$/u,'$1');
  if(file.startsWith('/assets/title/')||!existsSync(join(tree,'public',file))||!statSync(join(tree,'public',file)).isFile()||!isArt(file.slice(1)))return false;
  return named.has(file)||file.includes(slug)||(engineList!==undefined&&!engineList.has(file.slice(1)));
};

const live=readJson(join(root,'test/pins/catalogue.json'));
const row=live.shards.find((/** @type {{slug:string}} */ shard)=>shard.slug===slug);
if(row===undefined)throw new Error(`test/pins/catalogue.json has no ${slug}`);
const catalogue={...live,shards:live.shards.map((/** @type {{slug:string}} */ shard)=>shard.slug===slug?{...shard,hash}:shard)};
/** @type {Awaited<ReturnType<typeof serve>>|null} */
let preview=null;
/** @type {import('node:http').Server|null} */
let packs=null;
/** @type {import('playwright').Browser|null} */
let browser=null;
try{
  const pristine=join(work,'dist.pristine');
  if(!existsSync(pristine)){
    rmSync(tree,{recursive:true,force:true});
    const archive=execFileSync('git',['archive','HEAD'],{maxBuffer:1024*1024*1024});
    mkdirSync(tree);execFileSync('tar',['-x','-C',tree],{input:archive});linkNodeModules(root,tree);
    // The page bakes Dunes only (cook-to-play's build): the zone reaches it from its cook alone.
    node(['src/scripts/pins.ts','install','sunscar-dunes']);
    const dunes={...catalogue,shards:catalogue.shards.filter((/** @type {{slug:string}} */ shard)=>shard.slug==='sunscar-dunes'),
      placements:catalogue.placements.filter((/** @type {{slug:string}} */ place)=>place.slug.replace(/^_/u,'')==='sunscar-dunes')};
    writeFileSync(join(work,'catalogue.json'),JSON.stringify(dunes));
    const list=join(work,'tree-files.json'),sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
    writeFileSync(list,JSON.stringify({root:realpathSync(tree),files:execFileSync('git',['ls-tree','-r','--name-only','-z','HEAD'],{encoding:'utf8',maxBuffer:16*1024*1024}).split('\0').filter(file=>file!=='')}));
    execFileSync('python3',['src/scripts/heavy-lane.py','build','--',process.execPath,'src/scripts/build-app.mjs','--mode','preview'],{cwd:tree,stdio:'inherit',timeout:900000,
      env:{...process.env,WS_BUILD_ID:sourceBuildId(sha),WILDSHARD_CATALOGUE:join(work,'catalogue.json'),WS_GENERATION_TREE_FILES:list,WS_GENERATION_TREE_ROOT:realpathSync(tree)}});
    cpSync(join(tree,'dist'),pristine,{recursive:true});
  }
  // One cook per tarball: a kept run reuses its page build and cooks each new tarball once.
  if(!existsSync(join(cooked,'receipt.json'))){
    // The cook reads the pin table and the pin cache: point both at this tarball.
    const pins=readJson(join(root,'test/pins/shardfiles.json')),table=join(work,`shardfiles-${hash.slice(0,12)}.json`);
    writeFileSync(table,JSON.stringify({...pins,shards:pins.shards.map((/** @type {{slug:string}} */ pin)=>pin.slug===slug?{...pin,hash,bytes:tarball.length}:pin)}));
    mkdirSync(cache,{recursive:true});copyFileSync(resolvePath(o.tarball),join(cache,`${hash}.tar`));
    // The cook runs from this checkout (its renderer and validator revisions read git), over this tarball's pin row.
    const {build}=readJson(join(pristine,'version.json'));rmSync(cooked,{recursive:true,force:true});
    execFileSync(process.execPath,['src/scripts/ring-cook.mjs','--ring2',`--only=${slug}`,`--pins=${table}`,`--out=${cooked}`,`--build=${build}`,'--timeout-ms=1500000'],
      {cwd:root,stdio:'inherit',timeout:1800000,env:{COOK_CPU_SLOTS:'4',...process.env,WILDSHARD_PIN_CACHE:cache}});
  }
  const dist=join(tree,'dist'),receipt=readJson(join(cooked,'receipt.json'));
  if(receipt.heads.length!==1||receipt.heads[0].hash!==hash)throw new Error('The kept cook is of another tarball');
  const store=folderStore(join(cooked,'store'));
  /** @type {{key:string,status:number}[]} */ const cookReads=[];
  packs=createServer((request,response)=>{
    const key=new URL(request.url??'/','http://127.0.0.1').pathname.slice(1);
    void store.get(key).then(bytes=>{
      cookReads.push({key,status:bytes===undefined?404:200});
      if(bytes===undefined){response.writeHead(404,{'access-control-allow-origin':'*'}).end();return;}
      const headers=objectHeaders(key);
      response.writeHead(200,{'content-type':headers.type,'cache-control':headers.cache,'access-control-allow-origin':'*',
        ...headers.encoding===undefined?{}:{'content-encoding':headers.encoding}}).end(bytes);
    }).catch(()=>{response.writeHead(404,{'access-control-allow-origin':'*'}).end();});
  });
  await new Promise(done=>{packs?.listen(0,'127.0.0.1',()=>{done(null);});});
  const address=packs.address();if(address===null||typeof address==='string')throw new Error('No pack origin');
  const origin=`http://127.0.0.1:${address.port}`;
  // Attaching names this run's pack origin in the page, so each run attaches to a fresh copy of the unattached build.
  rmSync(dist,{recursive:true,force:true});cpSync(pristine,dist,{recursive:true});
  const added=await addStoredShards(dist,receipt.heads,store,()=>Promise.resolve(tarball),{base:origin,shards:[]},catalogue);
  if(!added.includes(slug))throw new Error(`The store attached ${added.join(', ')}, not ${slug}`);
  preview=await serve(tree,'',true);
  const require=createRequire(join(root,'package.json'));
  const {chromium}=await admittedPlaywright(require('playwright'));
  const gpu=process.platform==='darwin'?['--use-angle=metal','--enable-gpu','--ignore-gpu-blocklist']:['--use-angle=swiftshader','--enable-unsafe-swiftshader'];
  const launched=await chromium.launch({headless:true,args:['--mute-audio','--no-first-run','--disable-extensions',...gpu,...KEYCHAIN_ARGS]});browser=launched;
  const page0=new URL(preview.url).origin;
  /** @type {Record<string, {gameplayMs:number|null,textures:unknown,requests:number,fromCook:number,fromPage:number,zoneFromPage:string[],missing:string[],errors:string[]}>} */
  const results={};
  const shapes={desktop:{viewport:{width:1280,height:800},deviceScaleFactor:1},
    phone:{viewport:{width:402,height:874},deviceScaleFactor:3,isMobile:true,hasTouch:true,
      userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'}};
  let failed=false;
  for(const tier of o.tiers.split(',')){
    const shape=shapes[/** @type {'desktop'|'phone'} */ (tier)];if(shape===undefined)throw new Error(`Unknown tier ${tier}`);
    const context=await launched.newContext({...shape,serviceWorkers:'block'}),page=await context.newPage();
    // The page reads the cook from a second loopback origin, which Chromium's local network access asks leave for.
    await context.grantPermissions(['local-network-access'],{origin:page0});await saveFixture(context,NAME_ASKED);
    /** @type {{url:string,status:number,failure?:string}[]} */ const requests=[];/** @type {string[]} */ const errors=[];
    context.on('requestfinished',(/** @type {import('playwright').Request} */ request)=>{void request.response().then((/** @type {import('playwright').Response|null} */ answer)=>{requests.push({url:request.url(),status:answer?.status()??0});});});
    context.on('requestfailed',(/** @type {import('playwright').Request} */ request)=>{requests.push({url:request.url(),status:-1,failure:request.failure()?.errorText});});
    page.on('console',(/** @type {import('playwright').ConsoleMessage} */ message)=>{if(message.type()==='error')errors.push(`console: ${message.text().slice(0,300)}`);});
    page.on('pageerror',(/** @type {Error} */ error)=>{errors.push(String(error.message).slice(0,300));});
    const started=Date.now();let gameplayMs=null,why=null;
    try{
      await enterZone(page,{zone:slug,base:preview.url,flags:'mute=1&nolock=1&skipintro=1&sw=0',alone:true,waitUntil:'commit',timeout:Number(o.timeout)});
      // Gameplay as the boot cases judge it (parity/boot-smoke.mjs bootObservation): play state, HUD in, a valid player.
      for(const deadline=Date.now()+Number(o.timeout);;){
        const seen=await page.evaluate(bootObservation).catch(()=>null);
        if(seen!==null&&seen.fatal.length>0)throw new Error(`fatal: ${seen.fatal.join(' | ').slice(0,300)}`);
        if(seen?.ready===true)break;
        if(seen?.revealing===true)await page.locator('.ws-grid-reveal').dispatchEvent('pointerdown').catch(()=>undefined);
        if(Date.now()>deadline)throw new Error(`no gameplay in ${o.timeout} ms (app ${seen?.appState ?? 'unavailable'})`);
        await page.waitForTimeout(500);
      }
      gameplayMs=Date.now()-started;
      await page.waitForTimeout(Number(o.settle));
      why=await page.evaluate(()=>{const ws=/** @type {{__wildshard?:{textures?:()=>unknown}}} */ (/** @type {unknown} */ (window)).__wildshard;return ws?.textures?.()??null;});
    }catch(error){errors.push(String(error instanceof Error?error.message:error).split('\n')[0]);}
    await page.screenshot({path:join(out,`${slug}-${tier}.jpg`),type:'jpeg',quality:80}).catch(()=>undefined);
    await context.close();
    const onPage=requests.filter(row=>row.url.startsWith(page0)).map(row=>({...row,path:new URL(row.url).pathname}));
    const zoneFromPage=onPage.filter(row=>row.status>=200&&row.status<400&&zoneArt(row.path)).map(row=>row.path);
    const missing=requests.filter(row=>row.status===404||row.status===-1).map(row=>row.url.replace(page0,'').replace(origin,'cook:')+(row.failure===undefined?'':` (${row.failure})`));
    const result={gameplayMs,textures:why,requests:requests.length,fromCook:requests.filter(row=>row.url.startsWith(origin)).length,
      fromPage:onPage.length,zoneFromPage:[...new Set(zoneFromPage)].sort(),missing:[...new Set(missing)].sort(),errors};
    results[tier]=result;
    if(gameplayMs===null||zoneFromPage.length>0)failed=true;
    console.log(`${slug} ${tier}: gameplay ${gameplayMs===null?'MISSED':`${gameplayMs} ms`}, ${requests.length} requests (${result.fromCook} cook, ${onPage.length} page), zone art from the page ${result.zoneFromPage.length}, missing ${result.missing.length}`);
  }
  writeFileSync(join(out,`${slug}.json`),JSON.stringify({slug,hash,bytes:tarball.length,sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),results,cookReads:cookReads.length},null,1));
  if(failed)process.exitCode=1;
}finally{
  await browser?.close();preview?.close();
  if(packs!==null){packs.closeAllConnections();await new Promise(done=>{packs?.close(()=>{done(null);});});}
  if(!o.keep&&o.reuse===undefined)rmSync(work,{recursive:true,force:true});
  else console.log(`kept: ${work}`);
}
