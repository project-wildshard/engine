#!/usr/bin/env node
// P2 / EG-13: a real build ships Template only; production store attachment adds
// the other two Ring 1 pins. Each then reaches actual gameplay from those bytes.
// Ring 2: includes a fresh client build and cold q11 cooks (over ten seconds).
import {execFileSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {createServer} from 'node:http';
import {homedir} from 'node:os';
import {join,resolve as resolvePath} from 'node:path';
import {linkNodeModules} from './link-node-modules.mjs';
import {browserPool} from './parity/pool.mjs';
import {serve} from './parity/serve.mjs';
import {bootCase} from './parity/boot-smoke.mjs';

await import('./bake-loader.mjs');
const {folderStore} = await import('../src/cook/game/packStore.ts');
const {objectHeaders} = await import('../src/cook/game/cookWorker.ts');
const {addStoredShards} = await import('./app-build/catalogue.ts');
const {bareSlug} = await import('../src/shared/game/grid/catalogueSlot.ts');
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
  node(['scripts/pins.ts','install','template'],tree);
  /** @type {import('@wildshard/format/standaloneCatalogue').StandaloneCatalogue} */
  const live=JSON.parse(readFileSync('out/.ring-catalogue.json','utf8'));
  const selected={...live,shards:live.shards.filter(row=>row.slug==='template'),placements:live.placements.filter(row=>bareSlug(row.slug)==='template')};
  const catalogue=join(work,'catalogue.json');writeFileSync(catalogue,JSON.stringify(selected));
  execFileSync('python3',['scripts/heavy-lane.py','build','--',process.execPath,'scripts/build-app.mjs'],{
    cwd:tree,env:{...process.env,VERCEL_GIT_COMMIT_SHA:sha,WILDSHARD_CATALOGUE:catalogue},stdio:'inherit',timeout:300000});
  const dist=join(tree,'dist'),{build}=JSON.parse(readFileSync(join(dist,'version.json'),'utf8'));
  const cooked=join(work,'cooked');
  node(['scripts/ring-cook.mjs',`--out=${cooked}`,`--build=${build}`]);
  /** @type {{heads:{slug:string,hash:string}[],indexes:{slug:string,header:string,keys:string[]}[]}} */
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
  const added=await addStoredShards(dist,receipt.heads,store,hash=>Promise.resolve(readFileSync(join(pinCache,`${hash}.tar`))),{base:origin,shards:[]},live);
  if(added.length!==2||!added.includes('blender-template')||!added.includes('sunscar-dunes'))throw new Error(`Store attached ${added}`);
  preview=await serve(tree,'',true);pool=browserPool(root,1,process.platform==='darwin'?'metal':'swiftshader',true);
  const browser=await pool.browser(0),results=[];
  const titleText=/<script type="application\/json" id="ws-title-rows">([^<]*)<\/script>/u.exec(readFileSync(join(dist,'index.html'),'utf8'))?.[1];
  if(titleText===undefined)throw new Error('No published title routes');
  /** @type {{slug:string}[]} */ const titles=JSON.parse(titleText);
  for(const index of receipt.indexes) {
    const route=titles.find(row=>bareSlug(row.slug)===bareSlug(index.slug))?.slug;
    if(route===undefined)throw new Error(`No public title route for ${index.slug}`);
    const result=await bootCase(browser,preview.url,'standalone',out,route,true);
    results.push({slug:index.slug,route,frames:result.frame,ms:result.elapsedMs});
  }
  const keys=new Set(receipt.indexes.filter(row=>added.includes(row.slug)).flatMap(row=>row.keys));
  if(fetched.size===0)throw new Error('No cooked part reached the page');
  for(const key of fetched)if(!keys.has(key))throw new Error(`Page fetched outside this cook: ${key}`);
  const proof={sha,build,added,fetched:[...fetched],results};
  writeFileSync(join(out,'cook-to-play.json'),JSON.stringify(proof));console.log(JSON.stringify(proof));
} finally {
  writeFileSync(join(out,'store-requests.json'),JSON.stringify(fetches));
  await pool?.close();preview?.close();
  if(packs!==null){packs.closeAllConnections();await new Promise(resolve=>{packs?.close(()=>{resolve(null);});});}
  rmSync(work,{recursive:true,force:true});
}
