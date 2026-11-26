#!/usr/bin/env node
// P2 / EG-13: a real build ships Dunes only; production store attachment
// replaces it and adds the other Ring 1 pin (Brasscap Mesa). Both play those bytes (J434).
// Ring 2: includes a fresh client build and cold q11 cooks (over ten seconds).
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,realpathSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {homedir} from 'node:os';
import {join,resolve as resolvePath} from 'node:path';
import {linkNodeModules} from './link-node-modules.mjs';
import {sourceBuildId} from './app-build/buildIdentity.mjs';
import {browserPool} from './parity/pool.mjs';
import {serve} from './parity/serve.mjs';
import {bootCase} from './parity/boot-smoke.mjs';
import {uncataloguedShardCase} from './uncatalogued-shard-proof.mjs';
import {levelDownloadFixtures,saveFixture} from './debug-settings.mjs';

await import('./bake-loader.mjs');
const {folderStore} = await import('../src/cook/game/packStore.ts');
const {objectHeaders} = await import('../src/cook/game/cookWorker.ts');
const {addStoredShards} = await import('./app-build/catalogue.ts');
const {bareSlug} = await import('../src/shared/game/grid/catalogueSlot.ts');
const {auditCook,reportCook} = await import('./cook-audit.ts');
const {ringCookInputs} = await import('./ring-cook-inputs.ts');
const {packsBookPath} = await import('../src/shared/game/shardfile/spawnManifest.ts');
const root=process.cwd(),arg=process.argv.find(row=>row.startsWith('--out='));
const out=resolvePath(arg?.slice(6)??'tmp/cook-to-play');
mkdirSync(out,{recursive:true});
const work=mkdtempSync(join(out,'.run-')),tree=join(work,'tree');mkdirSync(tree);
const sha=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
/** @param {string[]} args @param {string} [cwd] @param {NodeJS.ProcessEnv} [env] */
const node=(args,cwd=root,env=process.env)=>execFileSync(process.execPath,args,{cwd,env,stdio:'inherit',timeout:300000});
/** @type {ReturnType<typeof serve> extends Promise<infer T> ? T|null : never} */
let preview=null;
/** @type {ReturnType<typeof browserPool>|null} */ let pool=null;
/** @type {import('node:http').Server|null} */ let packs=null;
/** @type {string[]} */ const fetches=[];
try {
  const archive=execFileSync('git',['archive','HEAD'],{maxBuffer:512*1024*1024});
  execFileSync('tar',['-x','-C',tree],{input:archive});linkNodeModules(root,tree);
  node(['scripts/pins.ts','install','sunscar-dunes'],tree);
  /** @type {import('@wildshard/format/standaloneCatalogue').StandaloneCatalogue} */
  const live=JSON.parse(readFileSync('out/.ring-catalogue.json','utf8'));
  const selected={...live,shards:live.shards.filter(row=>row.slug==='sunscar-dunes'),placements:live.placements.filter(row=>bareSlug(row.slug)==='sunscar-dunes')};
  const catalogue=join(work,'catalogue.json');writeFileSync(catalogue,JSON.stringify(selected));
  // The tree is a `git archive` under this checkout's tmp/, so `git rev-parse` there names the outer checkout: hand the
  // build HEAD's own file list instead (source-input-proof.mjs's inventory), as build-mirror.mjs does (main ci 43064007268)
  const files=join(work,'tree-files.json');
  writeFileSync(files,JSON.stringify({root:realpathSync(tree),files:execFileSync('git',['ls-tree','-r','--name-only','-z','HEAD'],{encoding:'utf8',maxBuffer:16*1024*1024}).split('\0').filter(file=>file!=='')}));
  execFileSync('python3',['scripts/heavy-lane.py','build','--',process.execPath,'scripts/build-app.mjs','--mode','preview'],{
    cwd:tree,env:{...process.env,WS_BUILD_ID:sourceBuildId(sha),WILDSHARD_CATALOGUE:catalogue,WS_GENERATION_TREE_FILES:files,WS_GENERATION_TREE_ROOT:realpathSync(tree)},stdio:'inherit',timeout:300000});
  const dist=join(tree,'dist'),{build}=JSON.parse(readFileSync(join(dist,'version.json'),'utf8'));
  const cooked=join(work,'cooked');
  node(['scripts/ring-cook.mjs',`--out=${cooked}`,`--build=${build}`]);
  const audit=await auditCook(join(cooked,'receipt.json'));reportCook(audit);
  writeFileSync(join(out,'cook-audit.json'),JSON.stringify(audit));
  /** @type {{heads:{slug:string,hash:string}[],indexes:{slug:string,header:string,keys:string[],manifests:{url:string}[]}[]}} */
  const receipt=JSON.parse(readFileSync(join(cooked,'receipt.json'),'utf8'));
  const store=folderStore(join(cooked,'store')),fetched=new Set();
  packs=createServer((request,response)=>{
    const key=new URL(request.url??'/', 'http://127.0.0.1').pathname.slice(1);
    fetches.push(key);
    void store.get(key).then(bytes=>{
      if(bytes===undefined){response.writeHead(404,{'access-control-allow-origin':'*'}).end();return undefined;}
      fetched.add(key);const headers=objectHeaders(key);
      response.writeHead(200,{'content-type':headers.type,'cache-control':headers.cache,'access-control-allow-origin':'*',
        ...headers.encoding===undefined?{}:{'content-encoding':headers.encoding}}).end(bytes);return undefined;
    }).catch(()=>{response.writeHead(404,{'access-control-allow-origin':'*'}).end();});
  });
  await new Promise(resolve=>{packs?.listen(0,'127.0.0.1',()=>{resolve(null);});});
  const address=packs.address();if(address===null||typeof address==='string')throw new Error('No pack origin');
  const origin=`http://127.0.0.1:${address.port}`;
  const pinCache=process.env.WILDSHARD_PIN_CACHE??join(homedir(),'.cache/wildshard/pins');
  // The production installer preserves bundled products. Retire Dunes'
  // bundled route so it too must read this run's cook, as nightly-heads does.
  const htmlFile=join(dist,'index.html'),html=readFileSync(htmlFile,'utf8');
  const expression=/(<script type="application\/json" id="boot-module-files">)([^<]+)(<\/script>)/u;
  const text=expression.exec(html)?.[2];if(text===undefined)throw new Error('Missing build bank');
  const bank=JSON.parse(text);
  const expected=['brasscap-mesa','sunscar-dunes'];
  const inputs=ringCookInputs(expected,receipt.heads,pinCache);
  for(const head of receipt.heads)if(!inputs.heads.some(row=>row.slug===head.slug&&row.hash===head.hash))throw new Error('Cook differs from the installed Ring 1 inputs');
  for(const rows of [bank.spawnManifests.client,bank.entryPrograms??{}])for(const slug of Object.keys(rows))if(expected.includes(bareSlug(slug)))delete rows[slug];
  writeFileSync(htmlFile,html.replace(expression,(_match,before,_body,after)=>`${before}${JSON.stringify(bank).replaceAll('<',String.raw`\u003c`)}${after}`));
  // The whole-pack book can retain authored aliases from the build too. Its
  // exact `_sunscar-dunes` row must not shadow the attached cook's `sunscar-dunes` row.
  const bookFile=join(dist,packsBookPath(build)),book=JSON.parse(readFileSync(bookFile,'utf8'));
  for(const slug of Object.keys(book.client??{}))if(expected.includes(bareSlug(slug)))delete book.client[slug];
  writeFileSync(bookFile,JSON.stringify(book));
  const added=await addStoredShards(dist,receipt.heads,store,hash=>Promise.resolve(inputs.read(hash)),{base:origin,shards:[]},live);
  if(added.length!==expected.length||expected.some(slug=>!added.includes(slug)))throw new Error(`Store attached ${added}`);
  if(receipt.indexes.length!==expected.length||expected.some(slug=>receipt.indexes.filter(index=>index.slug===slug).length!==1))throw new Error('Cook must name each Ring 1 product exactly once');
  preview=await serve(tree,'',true);pool=browserPool(root,1,process.platform==='darwin'?'metal':'swiftshader',true);
  const browser=await pool.browser(0),results=[];
  const titleText=/<script type="application\/json" id="ws-title-rows">([^<]*)<\/script>/u.exec(readFileSync(join(dist,'index.html'),'utf8'))?.[1];
  if(titleText===undefined)throw new Error('No published title routes');
  /** @type {{slug:string}[]} */ const titles=JSON.parse(titleText);
  for(const index of receipt.indexes) {
    const route=titles.find(row=>bareSlug(row.slug)===bareSlug(index.slug))?.slug;
    if(route===undefined)throw new Error(`No public title route for ${index.slug}`);
    fetched.clear();
    // CP16 (J522): the cooked zone boots alone, a one-cell world: the proof is its own bytes, with no neighbours to fetch
    const result=await bootCase(browser,preview.url,'alone',out,route,true,null,async context=>{
      for(const fixture of levelDownloadFixtures('packs'))await saveFixture(context,fixture);
    });
    const used=[...fetched];
    const parts=used.filter(key=>key.endsWith('.pack.br'));
    if(!parts.some(key=>/^assets\/spawn\/parts\/[a-f0-9]+\.pack\.br$/u.test(key)))throw new Error(`${index.slug}: no client part from this cook reached gameplay`);
    if(!index.manifests.some(row=>used.includes(row.url.slice(1))))throw new Error(`${index.slug}: no manifest from this cook reached gameplay`);
    // Title preparation may fetch the other heads' cover images. Every actual
    // compressed part consumed by this gameplay boot must belong to this cook.
    for(const key of parts)if(!index.keys.includes(key))throw new Error(`${index.slug}: page fetched a part outside its cook: ${key}`);
    results.push({slug:index.slug,route,frames:result.frame,ms:result.elapsedMs,fetched:used,parts});
  }
  const refusals=[];
  for(const slug of ['driftwood-isle','not-in-this-catalogue'])refusals.push(await uncataloguedShardCase(browser,preview.url,slug));
  const proof={sha,build,added,fetched:[...new Set(results.flatMap(result=>result.fetched))],results,refusals};
  writeFileSync(join(out,'cook-to-play.json'),JSON.stringify(proof));console.log(JSON.stringify(proof));
} finally {
  writeFileSync(join(out,'store-requests.json'),JSON.stringify(fetches));
  await pool?.close();preview?.close();
  if(packs!==null){packs.closeAllConnections();await new Promise(resolve=>{packs?.close(()=>{resolve(null);});});}
  rmSync(work,{recursive:true,force:true});
}
