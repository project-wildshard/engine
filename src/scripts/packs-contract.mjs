#!/usr/bin/env node
// TC40 / J186: explicit Ring 2 only. Complete cold cooks and actual publisher
// SIGKILL/recovery exceed ten seconds. Never a hook or ordinary test discovery.
import { agentFetch as fetch } from './agent-requests.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {appendFileSync,mkdirSync,readFileSync,rmSync,utimesSync,writeFileSync} from 'node:fs';
import {get as httpGet} from 'node:http';
import {get as httpsGet} from 'node:https';
import {stripTypeScriptTypes} from 'node:module';
import {homedir} from 'node:os';
import {basename,join,resolve as resolvePath} from 'node:path';
import {pathToFileURL} from 'node:url';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import {Miniflare} from 'miniflare';

const root=resolvePath(import.meta.dirname,'..', '..');
/** @param {Uint8Array|string} bytes */
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
/** @param {Uint8Array} bytes */
const decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
/** @param {unknown} value */
const bytes=value=>new TextEncoder().encode(JSON.stringify(value));
/** @param {string} key */
const partKey=key=>key.endsWith('.pack.br');
/** @param {string} directory */
const receiptAt=directory=>join(directory,'receipt.json');
/** The publisher's independent byte counts, retained before the test mutates a store.
 * @param {string} directory */
function producerSizes(directory){
  return new Map(readFileSync(join(directory,'writes.jsonl'),'utf8').trim().split('\n').map(line=>{
    const row=JSON.parse(line);return /** @type {[string,number]} */([String(row.key),Number(row.bytes)]);
  }));
}

/** Raw HTTP keeps a stored Brotli body compressed, unlike fetch.
 * @param {string} url @param {Record<string,string>} headers
 * @returns {Promise<{status:number|undefined,headers:import('node:http').IncomingHttpHeaders,body:Buffer}>} */
function wire(url,headers={}) {
  return new Promise((resolve,reject)=>{
    const request=(url.startsWith('https:')?httpsGet:httpGet)(url,{headers:{'accept-encoding':'br',...headers}},response=>{
      /** @type {Buffer[]} */const chunks=[];response.on('data',chunk=>{chunks.push(chunk);});response.on('error',reject);
      response.on('end',()=>{resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks)});});
    });
    request.setTimeout(15_000,()=>{request.destroy(new Error('Pack read deadline'));});request.on('error',reject);
  });
}

/** Read-only, post-deploy CF2: use a part named by the current channel. */
async function liveRead() {
  const origin='https://packs.wildshard.io',envelope=await(await fetch(`${origin}/releases/staging.json`,{signal:AbortSignal.timeout(15_000)})).json();
  const release=JSON.parse(envelope.body),book=await(await fetch(`${origin}/assets/spawn/server-${release.engineBuild}.json`,{signal:AbortSignal.timeout(15_000)})).json();
  const part=/** @type {import('../shared/game/shardfile/serverPack').ServerPackPart|undefined} */(Object.values(book.shards)[0]);assert.ok(part?.url&&part.hash);
  const headers={origin:'https://staging.wildshard.io'};
  const full=await wire(origin+part.url,headers),range=await wire(origin+part.url,{...headers,range:'bytes=0-9'});
  const past=await wire(origin+part.url,{...headers,range:`bytes=${full.body.length+10}-`});
  assert.equal(full.status,200);assert.equal(full.headers['content-encoding'],'br');
  const plain=brotliDecompressSync(full.body);assert.equal(digest(plain),part.hash);assert.equal(plain.length,part.bytes);
  assert.equal(full.body.length,part.wireBytes);assert.equal(full.headers['access-control-allow-origin'],headers.origin);
  assert.equal(full.headers['cross-origin-resource-policy'],'cross-origin');
  assert.equal(range.status,206);assert.equal(range.headers['content-encoding'],undefined);
  assert.equal(range.headers['content-range'],`bytes 0-9/${full.body.length}`);assert.ok(range.body.equals(full.body.subarray(0,10)));
  assert.equal(past.status,416);
  return {serial:release.serial,engineBuild:release.engineBuild,url:part.url,hash:part.hash,wireBytes:full.body.length,decodedBytes:plain.length,
    full:full.status,range:range.status,rangeEncoding:range.headers['content-encoding']??null,past:past.status};
}

/** Verify bytes, rather than trusting a store's has() or the publisher's row.
 * @param {import('../cook/game/packStore').PackStore} store
 * @param {import('../cook/game/cookWorker').CookIndex} index
 * @param {Map<string,number>} expected */
async function verify(store,index,expected) {
  const rows=new Map((await store.list('')).map(row=>[row.key,row]));let parts=0;
  for(const key of index.keys){
    const body=await store.get(key);assert.ok(body,`Missing published key ${key}`);
    assert.equal(body.length,rows.get(key)?.bytes,`Stored size ${key}`);
    assert.equal(body.length,expected.get(key),`Producer size ${key}`);
    if(partKey(key)){
      const plain=brotliDecompressSync(body),named=/^([a-f0-9]{16,64})\.pack\.br$/u.exec(basename(key))?.[1];
      assert.ok(named&&digest(plain).startsWith(named),`Part hash ${key}`);parts++;
    }
  }
  assert.ok(parts>0,'The real cook must publish actual compressed parts');
  return {keys:index.keys.length,parts};
}

/** @param {string[]} args @param {NodeJS.ProcessEnv} env
 * @param {NodeJS.Signals|null} expectedSignal @returns {Promise<string>} */
function runChild(args,env={},expectedSignal=null) {
  return new Promise((resolve,reject)=>{
    const child=spawn(process.execPath,args,{cwd:root,env:{...process.env,...env},detached:true,stdio:['ignore','pipe','pipe']});
    let output='';
    /** @param {Buffer} chunk */
    const take=chunk=>{output=(output+chunk.toString('utf8')).slice(-2_000_000);};child.stdout.on('data',take);child.stderr.on('data',take);
    let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;if(child.pid!==undefined)try{process.kill(-child.pid,'SIGKILL');}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ESRCH'))throw error;}},180_000);
    child.on('error',error=>{clearTimeout(timer);reject(error instanceof Error?error:new Error(String(error)));});
    child.on('close',(code,signal)=>{clearTimeout(timer);try{assert.equal(timedOut,false,'Publisher exceeded its 180s outer cleanup deadline');assert.equal(signal,expectedSignal,output);if(expectedSignal===null)assert.equal(code,0,output);resolve(output);}catch(error){reject(error instanceof Error?error:new Error(String(error)));}});
  });
}

/** @typedef {{directory:string,cut?:number}} PublisherConfig */
/** @param {PublisherConfig} config */
async function publisher(config) {
  assert.equal(process.env.GITHUB_ACTIONS,'true','Real cooks run only on hosted Actions');assert.equal(process.platform,'linux');
  assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted','No self-hosted cook');
  await import('./bake-loader.mjs');
  const {createCookWorker,indexKey}=await import('../cook/game/cookWorker.ts');
  const {folderStore,r2Store}=await import('../cook/game/packStore.ts');
  const {ringCookInputs}=await import('./ring-cook-inputs.ts');
  const {rendererRevision}=await import('./renderer-revision.mjs');
  const pins=decode(readFileSync(join(root,'test/pins/shardfiles.json'))).shards;
  const input=ringCookInputs(['brasscap-mesa'],pins,process.env.WILDSHARD_PIN_CACHE??join(homedir(),'.cache/wildshard/pins'));
  const head=input.heads[0],base=folderStore(join(config.directory,'store'));let written=0;
  // Exercise the real S3 serializer. The recording transport holds only this
  // proof's HTTP metadata/body facts, with no request to an external service.
  const serialized=r2Store({endpoint:'https://packs.invalid',bucket:'packs',accessKeyId:'proof',secretAccessKey:'proof',fetch:(url,init)=>{
    const headers=new Headers(init?.headers),body=init?.body;assert.ok(body instanceof Uint8Array);
    const address=typeof url==='string'?url:url instanceof URL?url.href:url.url;
    const row={key:new URL(address).pathname.slice('/packs/'.length),bytes:body.length,hash:digest(body),headers:{type:headers.get('content-type'),cache:headers.get('cache-control'),encoding:headers.get('content-encoding')}};
    appendFileSync(join(config.directory,'serialized.jsonl'),`${JSON.stringify(row)}\n`);return Promise.resolve(new Response(null,{status:200}));
  }});
  /** @type {import('../cook/game/packStore').PackStore} */const store={...base,put:async(key,body,headers)=>{
    await serialized.put(key,body,headers);
    await base.put(key,body,headers);appendFileSync(join(config.directory,'writes.jsonl'),`${JSON.stringify({key,bytes:body.length,headers})}\n`);written++;
    // The producer has already closed before publication. This kills the actual
    // publisher after a durable PUT, with no encoder orphan or artificial error.
    if(config.cut===written)process.kill(process.pid,'SIGKILL');
  }};
  const worker=createCookWorker({build:'tc40',store,source:{heads:()=>Promise.resolve([{...head,revision:1}]),download:hash=>Promise.resolve(input.read(hash))},
    serverPacks:join(config.directory,'server'),scratch:join(config.directory,'jobs'),launcher:{root,execPath:process.execPath,
      loader:join(root,'src/scripts/bake-loader.mjs'),script:join(root,'src/scripts/cook-job.mjs'),wrap:[],renderer:rendererRevision(root),limits:{seconds:120,memoryMB:4096,heapMB:2048}}});
  const row=await worker.cook(head);assert.ok(['cooked','present'].includes(row.state),row.detail);
  const body=await store.get(indexKey('tc40',head.hash));assert.ok(body);const index=decode(body);await verify(store,index,producerSizes(config.directory));console.log(JSON.stringify({row,index}));
}

/** @param {string} directory @param {Record<string,unknown>} result */
async function hostedProof(directory,result) {
  assert.equal(process.env.GITHUB_ACTIONS,'true','Cold proofs run only on hosted Actions');assert.equal(process.platform,'linux');
  assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted','No self-hosted cook');
  await import('./bake-loader.mjs');
  const {folderStore}=await import('../cook/game/packStore.ts');
  const {collectGarbage,indexKey}=await import('../cook/game/cookWorker.ts');
  const baseline=join(directory,'baseline');mkdirSync(baseline,{recursive:true});
  /** @param {PublisherConfig} config @param {NodeJS.Signals|null} signal */
  const publish=(config,signal=null)=>{const file=join(config.directory,'config.json');writeFileSync(file,JSON.stringify(config));return runChild([import.meta.filename,'--publish',file],{},signal);};
  await publish({directory:baseline});
  /** @type {{key:string,bytes:number,headers:import('../cook/game/packStore').ObjectHeaders}[]} */
  const writes=readFileSync(join(baseline,'writes.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const source=folderStore(join(baseline,'store'));
  const indexWrite=writes.at(-1);assert.ok(indexWrite);assert.ok(indexWrite.key.startsWith('index/'));
  const indexBody=await source.get(indexWrite.key);assert.ok(indexBody);
  const index=decode(indexBody),sizes=producerSizes(baseline),verified=await verify(source,index,sizes);result.cf5=verified;
  // Actual workerd/R2, with the real cook's headers and bytes. The legacy
  // deployed Worker remains a frozen input; CF2 above covers today's CDN route.
  const workerSource=join(root,'test/fixtures/packs-worker/worker.ts');
  const provenance=decode(readFileSync(join(root,'test/fixtures/packs-worker/source.json')));assert.equal(digest(readFileSync(workerSource)),provenance.sha256);
  /** @type {{key:string,bytes:number,hash:string,headers:{type:string,cache:string,encoding:string|null}}[]} */
  const serialized=readFileSync(join(baseline,'serialized.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));
  const runtime=new Miniflare({cf:false,workers:[{config:{name:'packs',compatibilityDate:'2026-11-04',manifest:{mainModule:'worker.mjs',modules:{'worker.mjs':{type:'esm',contents:stripTypeScriptTypes(readFileSync(workerSource,'utf8'))}}},env:{PACKS:{type:'r2',name:'PACKS'}}}}]});
  try{
    // Miniflare's R2 proxy uses workerd types absent from the host project.
    /** @type {unknown} */const proxy=await runtime.getR2Bucket('PACKS');
    const bucket=/** @type {{put:(key:string,body:Uint8Array,options:{httpMetadata:{contentType:string,cacheControl:string,contentEncoding?:string}})=>Promise<unknown>}} */(proxy);
    const {origin}=await runtime.ready;
    for(const row of serialized){const body=await source.get(row.key);assert.ok(body);assert.equal(body.length,row.bytes);assert.equal(digest(body),row.hash);await bucket.put(row.key,body,{httpMetadata:{contentType:row.headers.type,cacheControl:row.headers.cache,...row.headers.encoding===null?{}:{contentEncoding:row.headers.encoding}}});}
    const part=writes.find(row=>partKey(row.key));assert.ok(part);
    const held=await wire(`${origin}/${part.key}`),raw=await source.get(part.key);assert.ok(raw);
    assert.ok(held.body.equals(Buffer.from(raw)),'workerd must serve exactly one Brotli layer');assert.equal(held.headers['content-encoding'],'br');assert.match(held.headers['cache-control']??'',/immutable/u);
    assert.ok(index.loose);
    const descriptor = await wire(`${origin}/${index.loose}${index.header}`);
    assert.equal(descriptor.status, 200);
    assert.match(descriptor.headers['cache-control'] ?? '', /immutable/u);
    const indexed = await wire(`${origin}/${indexWrite.key}`);
    assert.equal(indexed.status, 200);
    assert.equal(indexed.headers['cache-control'], 'public, max-age=300');
    result.cf4={part:part.key,wireBytes:held.body.length,encoding:held.headers['content-encoding'],serializedWrites:serialized.length,reader:'frozen historical Worker in real workerd/R2',workerSha256:provenance.sha256};
  }finally{await runtime.dispose();}
  const part=writes.find(row=>partKey(row.key));assert.ok(part);
  const original=await source.get(part.key);assert.ok(original);
  try{
    await source.remove(part.key);await assert.rejects(verify(source,index,sizes),/Missing published key/u);
    await source.put(part.key,original.subarray(0,-1),part.headers);await assert.rejects(verify(source,index,sizes),/Producer size/u);
    const changed=brotliCompressSync(Buffer.from('known-corrupt part')),sameSize=Buffer.alloc(original.length);assert.ok(changed.length<sameSize.length);sameSize.set(changed);
    await source.put(part.key,sameSize,part.headers);await assert.rejects(verify(source,index,sizes),/Part hash/u);
  }finally{await source.put(part.key,original,part.headers);}
  await verify(source,index,sizes);result.cf5={...verified,missingRefused:true,sizeRefused:true,sameSizeHashRefused:true,mutationCleanup:'test restores its own bytes; no production corruption-healing claim'};
  const partCuts=writes.flatMap((row,at)=>row.key.includes('/parts/')?[at+1]:[]),manifestCuts=writes.flatMap((row,at)=>row.key.startsWith('assets/spawn/')&&row.key.endsWith('.json')?[at+1]:[]);
  assert.ok(partCuts.length>1&&manifestCuts.length>1,'Both intermediate publication stages must be nonempty');
  const cuts=[{stage:'parts',cut:partCuts[Math.floor((partCuts.length-1)/2)]},{stage:'manifests',cut:manifestCuts[Math.floor((manifestCuts.length-1)/2)]},{stage:'index',cut:writes.length}];
  /** @type {unknown[]} */const interruptions=[];result.cf7=interruptions;
  for(const cut of cuts){
    const owned=join(directory,cut.stage);mkdirSync(owned,{recursive:true});await publish({directory:owned,cut:cut.cut},'SIGKILL');
    const actual=readFileSync(join(owned,'writes.jsonl'),'utf8').trim().split('\n').map(line=>JSON.parse(line));const lastWrite=actual.at(-1);assert.ok(lastWrite);assert.equal(actual.length,cut.cut);
    assert.ok(cut.stage==='parts'?lastWrite.key.includes('/parts/'):cut.stage==='manifests'?lastWrite.key.startsWith('assets/spawn/')&&lastWrite.key.endsWith('.json'):lastWrite.key.startsWith('index/'),'Killed write must match its actual stage');
    const store=folderStore(join(owned,'store')),before=await store.get(indexWrite.key);
    if(before!==undefined)await verify(store,decode(before),producerSizes(owned));else assert.notEqual(cut.stage,'index');
    await publish({directory:owned});const healedBytes=await store.get(indexWrite.key);assert.ok(healedBytes);await verify(store,decode(healedBytes),producerSizes(owned));
    interruptions.push({...cut,lastKey:lastWrite.key,actualWrites:actual.length,signal:'SIGKILL',indexBefore:before!==undefined,restarted:true});
    rmSync(owned,{recursive:true,force:true});
  }
  // Actual CLI: it reads all live channel graphs itself, even if the user
  // supplied an incomplete manual keep list. Only this proof's folder is mutable.
  const gc=join(directory,'gc');mkdirSync(gc,{recursive:true});
  const {liveDeployBuilds}=await import('./app-build/previousDeploy.mjs');
  const {readServerPack,serverPackBookPath}=await import('../shared/game/shardfile/serverPack.ts');
  const channels=await liveDeployBuilds(),store=folderStore(join(gc,'store')),kept=[];
  assert.ok(channels.some(row=>row.builds.length>1),'At least one real channel must carry an older build');
  const serverIndex=await source.get(index.serverPack.index.slice(1));assert.ok(serverIndex);const serverPack=readServerPack(decode(serverIndex));
  for(const segment of [serverPack,...serverPack.more??[]]){const key=segment.url.slice(1),body=await source.get(key);assert.ok(body);await store.put(key,body,{type:'application/octet-stream',cache:'no-store'});kept.push(key);}
  for(const build of new Set(channels.flatMap(row=>row.builds))){
    const key=indexKey(build,index.hash),loose=`loose/${index.hash}/${build}.bin`;
    await store.put(loose,original,{type:'application/octet-stream',cache:'no-store'});
    await store.put(key,bytes({...index,build,keys:[loose]}),{type:'application/json',cache:'no-store'});kept.push(loose);
    const book=serverPackBookPath(build);await store.put(book,bytes({book:'server',build,shards:{[index.slug]:serverPack}}),{type:'application/json',cache:'no-store'});kept.push(book,key);
  }
  await store.put('loose/obsolete.bin',original,{type:'application/octet-stream',cache:'no-store'});
  for(const row of await store.list(''))utimesSync(join(gc,'store',row.key),new Date(0),new Date(0));
  const before=(await store.list('')).map(row=>row.key);
  await assert.rejects(collectGarbage(store,['manual-only'],1e12,Date.now(),undefined,channels.flatMap(row=>row.builds)),/keep list misses channel builds/u);
  assert.deepEqual((await store.list('')).map(row=>row.key),before,'An incomplete channel keep list must delete nothing');
  const text=await runChild(['--import','./src/scripts/bake-loader.mjs','src/scripts/cook-worker.mjs','gc','manual-only'],{COOK_STORE_DIR:join(gc,'store')});
  const last=text.trim().split('\n').at(-1);assert.ok(last);const report=JSON.parse(last);assert.equal(report.channels.length,3);
  for(const key of kept)assert.ok(await store.has(key),`A channel's build was collected: ${key}`);
  assert.equal(await store.has('loose/obsolete.bin'),false);result.cf9={channels:report.channels,incompleteRefused:true,refusalDeletedNothing:true,retained:kept.length,deleted:report.deleted};
  rmSync(gc,{recursive:true,force:true});rmSync(baseline,{recursive:true,force:true});
}

if(process.argv[2]==='--publish')await publisher(decode(readFileSync(process.argv[3])));
else if(import.meta.url===pathToFileURL(process.argv[1]).href){
  const directory=resolvePath(process.argv.slice(2).find(arg=>arg!=='--live-only')??join(root,'tmp/packs-contract'));assert.ok(directory.startsWith(`${root}/tmp/`));mkdirSync(directory,{recursive:true});
  /** @type {Record<string,unknown>} */const result={complete:false,started:new Date().toISOString(),reportOnly:true};writeFileSync(receiptAt(directory),JSON.stringify(result));
  try{result.cf2=await liveRead();if(!process.argv.includes('--live-only')){await hostedProof(directory,result);result.complete=true;}else result.scope='CF2 only';}
  catch(error){result.error=error instanceof Error?error.stack:String(error);throw error;}
  finally{writeFileSync(receiptAt(directory),`${JSON.stringify(result,null,2)}\n`);}
}
