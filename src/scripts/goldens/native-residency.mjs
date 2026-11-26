import {createHash} from 'node:crypto';
import {existsSync,readdirSync,readFileSync} from 'node:fs';
import {homedir} from 'node:os';
import {join,dirname} from 'node:path';

/** Working candidates use the ordinary port registry, not a committed-SHA
 * shared lease. Its dist must still identify the actual served build.
 * @param {string} record */
export function workingGoldenPreviewFolder(record) {
  const matched=/^\d+\s+\d+\s+(.+)\s+\S+\s+\S+\s*$/u.exec(record.trim());
  const folder=matched?.[1];
  if(folder===undefined||!folder.startsWith('/')) throw new Error('Invalid working preview registry record');
  return folder;
}

/** SHARD SELECT replaces the document. Schedule this in every init-script
 * realm, after module-script bases exist and before the async world boot. */
export function queueGoldenResidencyInstall(install) {
  if (document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>{void install();},{once:true});
  else void install();
}

/** Rebind the release reader to this actual shared preview, never a copied chunk name.
 * @param {string} base @param {{build:string,sha:string}} source */
export async function goldenRefinementBinding(base,source) {
  const url=new URL(base);
  if (!['127.0.0.1','localhost'].includes(url.hostname)) throw new Error('Nine settled reader requires a local serve-build preview');
  const registry=join(homedir(),'.dev-servers','.shared');
  const matches=readdirSync(registry).filter(file=>file.endsWith('.json')).map(file=>JSON.parse(readFileSync(join(registry,file),'utf8')))
    .filter(row=>row.status==='ready'&&String(row.port)===url.port&&row.sha.startsWith(source.sha)&&row.coverage==='all'&&row.mode==='production');
  if (matches.length>1) throw new Error('Nine settled reader preview binding is ambiguous');
  const pinned=matches[0],folder=pinned?.out??workingGoldenPreviewFolder(readFileSync(join(dirname(registry),url.port),'utf8'));
  const root=join(folder,'dist'),version=JSON.parse(readFileSync(join(root,'version.json'),'utf8'));
  if(version.build!==source.build)throw new Error('Native reader dist differs from served version');
  const index=readFileSync(join(root,'shardfiles','nine-dragon-stack','shard.json'));
  const product=JSON.parse(index.toString('utf8'));
  if(product.format!=='wildshard.shardfile'||(product.formatVersion!==2&&typeof product.formatVersion!=='string')||product.identity?.slug!=='nine-dragon-stack')
    throw new Error('Native reader requires the served Nine product');
  const servedIndex=Buffer.from(await(await fetch(new URL('/shardfiles/nine-dragon-stack/shard.json',base))).arrayBuffer());
  if(!servedIndex.equals(index))throw new Error('Served Nine index differs from exact preview');
  const chunks=buildCodeChunks(root,source.build).map(chunk=>({chunk,bytes:readFileSync(join(root,chunk))}))
    .filter(row=>row.bytes.includes('Invalid or duplicate refinement job'));
  if (chunks.length!==1) throw new Error('Native refinement chunk is missing or ambiguous');
  const {chunk,bytes}=chunks[0],binding=refinementExports(bytes.toString('utf8'));
  const served=Buffer.from(await(await fetch(new URL(chunk,base))).arrayBuffer());
  if (!served.equals(bytes)) throw new Error('Served native refinement differs from exact preview');
  return {...binding,sha:pinned?.sha??source.sha,build:source.build,preview:pinned===undefined?'working-tree':'pinned',
    nineIndexSHA256:createHash('sha256').update(index).digest('hex'),chunk,chunkSHA256:createHash('sha256').update(served).digest('hex')};
}

/** Prefer the current build's chunk ownership graph (PZ5). Legacy builds use their own folder `b/<build>`, plus the
 * content-named chunks in the shared `b/c` that its `importmap.json` names (J217
 * LD6). The shared folder can also hold other builds' chunks, so it is never
 * listed. A build without `b/<build>` keeps everything in `assets/`.
 * @param {string} root the preview's dist @param {string} build */
export function buildCodeChunks(root,build) {
  const graph=join(root,'deploy-chunks.json');
  if (existsSync(graph)) return goldenScriptPaths(JSON.parse(readFileSync(graph,'utf8')),build).map(file=>`/${file}`);
  const own=`b/${build}`;
  if (!existsSync(join(root,own))) return readdirSync(join(root,'assets')).filter(file=>file.endsWith('.js')).map(file=>`/assets/${file}`);
  const chunks=readdirSync(join(root,own)).filter(file=>file.endsWith('.js')).map(file=>`/${own}/${file}`);
  const map=join(root,'importmap.json');
  if (existsSync(map)) for (const target of Object.values(JSON.parse(readFileSync(map,'utf8')).imports??{}))
    if (typeof target==='string'&&target.startsWith('/b/c/')&&target.endsWith('.js')&&!chunks.includes(target)) chunks.push(target);
  return chunks;
}

/** The current build's owned JavaScript, including shared chunks, excluding carry-only files.
 * @param {unknown} graph @param {string} build @returns {string[]} */
export function goldenScriptPaths(graph,build) {
  const rows=typeof graph==='object'&&graph!==null?Reflect.get(graph,'builds'):undefined;
  if (!Array.isArray(rows)) throw new Error('Golden chunk graph is missing');
  const owners=rows.filter(row=>row?.build===build);
  if (owners.length!==1||!Array.isArray(owners[0].files)) throw new Error('Golden build chunk ownership is ambiguous');
  return owners[0].files.map(row=>row.path).filter(path=>typeof path==='string'&&path.endsWith('.js')
    &&path.startsWith('b/')&&!path.split('/').some(part=>part==='..'||part===''||part.includes('\\')));
}

/** Fail closed when the compiler shape changes; no guessed export or copied release binding.
 * @param {string} source */
export function refinementExports(source) {
  const classes=[...source.matchAll(/([\w$]+)=class\{view;waiting=new Map;known=new Set/gu)];
  if (classes.length!==1) throw new Error('Native refinement class identity ambiguous');
  const match=classes[0],initializers=[...source.slice(0,match.index).matchAll(/function ([\w$]+)\(\)\{return\(/gu)];
  const initializer=initializers.at(-1)?.[1];
  if (initializer===undefined) throw new Error('Native refinement initializer unavailable');
  const exports=source.slice(source.lastIndexOf('export'));
  const alias=name=>{
    const escaped=name.replaceAll(/[.*+?^${}()|[\]\\]/gu,String.raw`\$&`);
    const rows=[...exports.matchAll(new RegExp(`(?<![\\w$])${escaped}\\s+as\\s+([\\w$]+)`,'gu'))];
    if (rows.length!==1) throw new Error('Native refinement export unavailable or ambiguous');
    return rows[0][1];
  };
  return {initializerExport:alias(initializer),classExport:alias(match[1])};
}

/** Observe publication without changing the native receiver, arguments or returned promise.
 * Serialized into the pre-navigation observer. */
export function observeRefinement(proto) {
  const original=proto.add,jobs=[];
  if (typeof original!=='function') throw new Error('Native refinement add missing');
  proto.add=function add(...args) {
    const promise=Reflect.apply(original,this,args),row={id:args[0],at:args[1],state:'pending'};
    jobs.push(row);
    void (async()=>{
      try {row.state=await promise?'published':'retired';}
      catch(error) {row.state='failed';row.error=String(error);}
    })();
    return promise;
  };
  return {jobs};
}

/** Same native publication fence as sp-ci-deploy's reader; the golden camera/composer protocol stays intact. */
export async function heldGoldenResidency() {
  const w=window.__wildshard.world,g=w.game,ledger=window.__goldenResidency;
  const snapshot=()=>JSON.stringify({frame:g.frameCount,clock:g.app.clock.snapshot(),camera:g.camera.matrixWorld.elements,player:w.player.position.toArray()});
  if (!g.hold||!ledger||ledger.jobs.length===0) throw new Error(`Native residency observer is not bound to a held world ${JSON.stringify({hold:g.hold,ledger:ledger!==undefined,jobs:ledger?.jobs.length??0,documentOrigin:performance.timeOrigin})}`);
  const before=snapshot(),start=Date.now();let turns=0;
  for (;;) {
    await new Promise(resolve=>{requestAnimationFrame(resolve);});turns++;
    if (ledger.jobs.some(row=>row.state==='failed'||row.state==='retired')) throw new Error('Native publication failed or retired');
    if (!ledger.jobs.some(row=>row.state==='pending')) {
      await new Promise(resolve=>{setTimeout(resolve,0);});
      if (!ledger.jobs.some(row=>row.state==='pending')) break;
    }
    if (Date.now()-start>=29000) throw new Error('Native publication did not settle');
  }
  const after=snapshot();
  const was=JSON.parse(before),now=JSON.parse(after);
  // Contact correction changed X by 3.7e-8 m on hosted WebKit. At x=18
  // one float32 transform unit is 1.9e-6 m. Rounding each value separately
  // would still fail when that tiny difference straddles a rounding boundary.
  // Keep raw positions, permit at most one native unit per coordinate, and
  // retain exact comparison for the held frame, clock and camera.
  const samePlayer=was.player.every((value,i)=>{
    const other=now.player[i];
    return Number.isFinite(value)&&Number.isFinite(other)&&Math.abs(value-other)<=2**(Math.floor(Math.log2(Math.max(1,Math.abs(value),Math.abs(other))))-23);
  });
  if (!samePlayer||JSON.stringify({...was,player:null})!==JSON.stringify({...now,player:null}))
    throw new Error(`Native wait changed frame, clock, camera or player: ${JSON.stringify({before:was,after:now})}`);
  return {jobs:ledger.jobs,heldState:was,playerAfter:now.player,playerPrecision:'one float32 unit',turns,elapsedMs:Date.now()-start,pending:0};
}
