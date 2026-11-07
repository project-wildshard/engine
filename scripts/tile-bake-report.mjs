// @ts-check
// NT7 is metadata-only. The existing all-product checkTileBake remains independent.
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import * as v from 'valibot';
import {outputFormat} from './shard-platform-format.mjs';

const {TilesSchema,SpawnSchema}=await import('@wildshard/format/shardSections');
const {EntrywaysSchema}=await import('@wildshard/format/entryways');
const {WorldScenesSchema}=await import('@wildshard/format/worldScenes');
const finite=v.pipe(v.number(),v.finite()), natural=v.pipe(finite,v.integer(),v.minValue(0),v.maxValue(Number.MAX_SAFE_INTEGER));
const vector=v.tuple([finite,finite,finite]);
const goldenCamera=v.looseObject({name:v.string(),eye:vector,yaw:finite,pitch:finite,fov:v.pipe(finite,v.minValue(1),v.maxValue(179))});
const cameraCatalogue=v.looseObject({cameras:v.record(v.string(),v.array(goldenCamera))});
/** Thresholds are advisory except the separate Nine baseline below. */
const limits={resident:4_000_000,triangles:40_000,draws:8,height:125,concentration:.8,outside:.2,thin:.05,holdGpu:120_000_000};
/** @param {Uint8Array|string} bytes */
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
/** @param {readonly number[]} a @param {readonly number[]} b */
const dot=(a,b)=>a.reduce((n,x,i)=>n+x*(b[i]??0),0);
/** @param {import('./tile-bake-report.mjs').BakeCamera} camera */
function planes(camera){
  const yaw=-camera.yaw*Math.PI/180,pitch=camera.pitch*Math.PI/180,cp=Math.cos(pitch),sp=Math.sin(pitch),cy=Math.cos(yaw),sy=Math.sin(yaw);
  const f=[-sy*cp,sp,-cy*cp],r=[cy,0,-sy],u=[sy*sp,cp,cy*sp],tv=Math.tan(camera.fov*Math.PI/360),th=tv*402/874;
  const normals=[...[-1,1].flatMap(sign=>[f.map((x,i)=>x*th+sign*(r[i]??0)),f.map((x,i)=>x*tv+sign*(u[i]??0))]),f];
  return normals.map(n=>({n,d:-dot(n,camera.eye)}));
}
/** Conservative AABB/frustum intersection, including a near plane at the eye.
 * @param {{min:readonly number[],max:readonly number[]}} box @param {import('./tile-bake-report.mjs').BakeCamera} camera */
export function tileBoxVisible(box,camera){return planes(camera).every(({n,d})=>n.reduce((sum,x,i)=>sum+x*((x>=0?box.max[i]:box.min[i])??0),d)>=0);}
/** @param {readonly number[]} eye @param {{min:readonly number[],max:readonly number[]}} box */
function distance(eye,box){return Math.hypot(...eye.map((x,i)=>Math.max((box.min[i]??0)-x,0,x-(box.max[i]??0))));}
/** @param {number} p */
const tile=p=>Math.max(0,Math.min(7,Math.floor((p+250)/62.5)));
/** @param {number} n */
const mb=n=>(n/1e6).toFixed(3);
/** @param {number} n */
const pct=n=>`${(n*100).toFixed(1)}%`;
/** @param {import('./tile-bake-report.mjs').TilingInput} input
 * @returns {import('./tile-bake-report.mjs').TilingReport} */
export function tileTilingReport(input){
  const admitted=v.parse(TilesSchema,input.tiles);
  const cameras=v.parse(v.array(v.looseObject({...goldenCamera.entries,origin:v.picklist(['spawn','entry','declared'])})),input.cameras);
  const chunks=v.parse(v.array(v.strictObject({id:v.string(),tile:v.pipe(natural,v.maxValue(63)),bytes:natural,box:v.tuple([finite,finite,finite,finite,finite,finite]),geometricError:v.pipe(finite,v.minValue(0))})),input.chunks);
  if(chunks.some(row=>row.box[3]<row.box[0]||row.box[4]<row.box[1]||row.box[5]<row.box[2]))throw new Error('Invalid chunk bounds');
  const tiles=admitted.map(row=>{
    const resident=row.decoded+row.gpu;
    return {...row,key:`${row.lod}/${row.x}/${row.z}`,resident,minY:row.bounds.min[1],maxY:row.bounds.max[1],height:row.bounds.max[1]-row.bounds.min[1],tall:row.bounds.max[1]-row.bounds.min[1]>limits.height,
      occupied:row.triangles>0||row.files.length>0||resident>0,over:Object.entries(limits).filter(([key,value])=>
        (key==='resident'?resident:key==='triangles'?row.triangles:key==='draws'?row.draws:0)>value&&['resident','triangles','draws'].includes(key)).map(([key])=>key)};
  });
  /** @param {number} lod */
  const level=lod=>tiles.filter(row=>row.lod===lod).reduce((sum,row)=>({gpu:sum.gpu+row.gpu,resident:sum.resident+row.resident,compressed:sum.compressed+row.compressed,triangles:sum.triangles+row.triangles,draws:sum.draws+row.draws,occupied:sum.occupied+Number(row.occupied)}),{gpu:0,resident:0,compressed:0,triangles:0,draws:0,occupied:0});
  const l0=level(0),l1=level(1),fine=admitted.filter(row=>row.lod===0);
  for(const count of [...Object.values(l0),...Object.values(l1)])if(!Number.isSafeInteger(count))throw new Error('Tiling aggregate exceeds exact integer range');
  const topFiveShare=l0.gpu===0?0:[...fine].sort((a,b)=>b.gpu-a.gpu).slice(0,5).reduce((sum,row)=>sum+row.gpu,0)/l0.gpu;
  const sightlines=cameras.map(camera=>{
    const x=tile(camera.eye[0]),z=tile(camera.eye[2]),seen=fine.filter(row=>row.triangles>0&&tileBoxVisible(row.bounds,camera));
    const visible=seen.reduce((sum,row)=>sum+row.triangles,0),outside=seen.filter(row=>Math.abs(row.x-x)>2||Math.abs(row.z-z)>2).reduce((sum,row)=>sum+row.triangles,0);
    const distances=seen.map(row=>distance(camera.eye,row.bounds)),fraction=visible===0?0:outside/visible;
    return {name:camera.name,origin:camera.origin,eyeY:camera.eye[1],visible,outside,fraction,cut:outside>0,over20:fraction>limits.outside,
      minDistance:distances.length===0?null:Math.min(...distances),maxDistance:distances.length===0?null:Math.max(...distances),
      heavy:seen.filter(row=>row.gpu>4_000_000).map(row=>{const d=distance(camera.eye,row.bounds);return {tile:`${row.x}/${row.z}`,distance:d,metresPerPixel:Math.max(1,d)*2*Math.tan(camera.fov*Math.PI/360)/(874*2)};})};
  });
  const spanning=input.parts.map(part=>({id:part.id,tiles:fine.filter(row=>row.files.some(file=>part.files.includes(file))).length})).filter(row=>row.tiles>4);
  const over20=sightlines.filter(row=>row.over20).length,cut=sightlines.filter(row=>row.cut).length,tallest=Math.max(0,...tiles.filter(row=>row.lod===0).map(row=>row.height));
  const l1Ratio=l0.triangles===0?1:l1.triangles/l0.triangles,thin=l1Ratio<limits.thin;
  const overCaps=tiles.filter(row=>row.lod===0&&row.over.length>0).length;
  const verdict=[];
  // Dense vertical cells are the special case this audit distinguishes from small,
  // spread-out worlds. Every other sightline warning is still printed below.
  if(over20>0&&l0.gpu<=limits.holdGpu&&topFiveShare>limits.concentration&&tallest>limits.height)verdict.push('hold the cell');
  if(overCaps>0||chunks.some(row=>row.bytes>limits.resident))verdict.push('re-cut');
  if(thin&&over20>0&&topFiveShare>limits.concentration&&tallest>limits.height)verdict.push('re-budget L1');
  return {slug:input.slug,ring:input.ring??'5x5',tiles,chunks,l0,l1,topFiveShare,tallest,overCaps,zeroError:tiles.filter(row=>row.occupied&&row.geometricError===0).length,spanning,sightlines,cut,over20,thin,l1Ratio,verdict};
}
/** Human tables A/B/D: measured declarations, never a live-memory or pixel claim.
 * @param {import('./tile-bake-report.mjs').TilingReport} report */
export function tilingMarkdown(report){
  const rows=[`NT7 ${report.slug} · ring ${report.ring} · verified declarations (not live memory)`,
    `source ${report.provenance?.indexHash??'in-memory'}; declared camera catalogue ${report.provenance?.cameraHash??'not declared'}`,
    'A · LOD/tile | GPU MB | decoded MB | resident MB | compressed MB | triangles | draws | minY..maxY | height (>125m) | error m | over 4MB/40k/8',
    ...report.tiles.map(row=>`${row.key} | ${mb(row.gpu)} | ${mb(row.decoded)} | ${mb(row.resident)} | ${mb(row.compressed)} | ${row.triangles} | ${row.draws} | ${row.minY.toFixed(2)}..${row.maxY.toFixed(2)} | ${row.height.toFixed(2)}${row.tall?' TALL':''} | ${row.geometricError} | ${row.over.join(',')||'-'}`),
    ...[report.l0,report.l1].map((level,lod)=>`cell L${lod} | GPU ${mb(level.gpu)} MB | resident ${mb(level.resident)} MB | compressed ${mb(level.compressed)} MB | ${level.triangles} triangles | ${level.draws} draws | ${level.occupied} occupied`),
    `occupied zero-error rows ${report.zeroError} (inspection only: genuinely lossless zero is legal); spanning parts >4 tiles ${report.spanning.length}`,
    ...report.spanning.map(row=>`part ${row.id} | ${row.tiles} tiles`),
    `chunks · ${report.chunks.length} declared · key | tile | bytes | minY..maxY | height | error m`,
    ...report.chunks.map(row=>`${row.id} | ${row.tile} | ${row.bytes} | ${row.box[1]}..${row.box[4]} | ${row.box[4]-row.box[1]} | ${row.geometricError}`),
    'B · camera (origin) | eyeY | visible triangles | outside 5x5 | fraction | nearest..farthest m | heavy tile distance:m/px',
    ...report.sightlines.map(row=>`${row.name} (${row.origin}) | ${row.eyeY.toFixed(2)} | ${row.visible} | ${row.outside} | ${pct(row.fraction)} | ${row.minDistance?.toFixed(1)??'-'}..${row.maxDistance?.toFixed(1)??'-'} | ${row.heavy.map(h=>`${h.tile} ${h.distance.toFixed(1)}:${h.metresPerPixel.toFixed(4)}`).join(';')}`),
    'D · shard | L0 GPU/resident MB | occupied | top5 GPU share | max chunk bytes | over-cap tiles | tallest m | L1/L0 triangles | cameras cut / >20%',
    `${report.slug} | ${mb(report.l0.gpu)}/${mb(report.l0.resident)} | ${report.l0.occupied} | ${pct(report.topFiveShare)} | ${report.chunks.length===0?'not declared':Math.max(...report.chunks.map(row=>row.bytes))} | ${report.overCaps} | ${report.tallest.toFixed(2)} | ${pct(report.l1Ratio)} | ${report.cut}/${report.sightlines.length} / ${report.over20}/${report.sightlines.length}`,
    `verdict ${report.verdict.join('; ')||'no dense-cell recommendation'}; sightlines/height/concentration/errors remain advisory`];
  return rows.join('\n');
}
const baselineSchema=v.strictObject({version:v.literal(1),product:v.literal('nine-dragon-stack'),ring:v.literal('cell'),chunks:v.strictObject({bytes:v.literal(4_000_000)}),
  tileDebt:v.record(v.pipe(v.string(),v.regex(/^0\/[0-7]\/[0-7]$/u)),v.strictObject({resident:natural,triangles:natural,draws:natural}))});
/** New separate guard: no other product is gated here. Existing tile debt stays
 * owned by checkTileBake; this Nine baseline cannot waive that earlier check.
 * @param {import('./tile-bake-report.mjs').TilingReport} report @param {unknown} input */
export function checkNineTiling(report,input){
  if(report.slug!=='nine-dragon-stack')return;
  const baseline=v.parse(baselineSchema,input);
  if(report.ring!==baseline.ring)throw new Error('Nine tiling regression: ring must remain cell');
  for(const row of report.tiles.filter(candidate=>candidate.lod===0))for(const key of ['resident','triangles','draws']){
    const value=key==='resident'?row.resident:key==='triangles'?row.triangles:row.draws;
    const cap=key==='resident'?limits.resident:key==='triangles'?limits.triangles:limits.draws;
    const allowance=baseline.tileDebt[row.key],prior=allowance===undefined?cap:key==='resident'?allowance.resident:key==='triangles'?allowance.triangles:allowance.draws;
    if(value>Math.max(cap,prior))throw new Error(`Nine tiling regression: ${row.key}/${key} ${value}`);
  }
  for(const chunk of report.chunks)if(chunk.bytes>baseline.chunks.bytes)throw new Error(`Nine tiling regression: chunk ${chunk.id} exceeds 4MB`);
  // Original long triangles cannot be cut without changing geometry. Height is
  // printed for NT3, not silently rounded, waived, or mislabelled a byte overrun.
}
/** Verify each section's source bytes before interpreting it.
 * @param {string} root @param {string} product @param {string} folder */
export function readTilingReport(root,product,folder){
  const bytes=readFileSync(resolve(folder,'shard.json')),index=outputFormat.parseOutputIndex(JSON.parse(bytes.toString('utf8')));
  if(index.identity.slug!==(product==='_template'?'template':product))throw new Error('Tiling product identity differs');
  const receipt=JSON.parse(readFileSync(resolve(folder,'validation.json'),'utf8'));
  if(receipt.indexHash!==hash(bytes))throw new Error('Tiling index receipt differs');
  /** @param {string} name */
  const section=name=>{
    const row=index.sections.find(item=>item.name===name);if(row===undefined)return null;
    const source=readFileSync(resolve(folder,row.path));if(source.length!==row.bytes||hash(source)!==row.hash)throw new Error(`Tiling section hash/size differs: ${name}`);
    return v.parse(v.record(v.string(),v.unknown()),outputFormat.validateOutputSection(name,JSON.parse(source.toString('utf8'))));
  };
  const tileSection=section('world/tiles');if(tileSection===null)throw new Error('Missing tiling section');
  const tiles=v.parse(TilesSchema,tileSection.tiles),ring=v.parse(v.optional(v.literal('cell')),tileSection.ring);
  const spawnSection=section('world/spawn'),edgeSection=section('world/edge'),scenesSection=section('world/scenes');
  /** @type {import('./tile-bake-report.mjs').BakeCamera[]} */const cameras=[];
  if(spawnSection!==null&&spawnSection.spawn!==undefined){const spawn=v.parse(SpawnSchema,spawnSection.spawn);cameras.push({name:'spawn',origin:'spawn',eye:[spawn.x,spawn.y+1.7,spawn.z],yaw:-spawn.yaw*180/Math.PI,pitch:0,fov:93.0105});}
  if(edgeSection!==null&&edgeSection.entryways!==undefined)for(const entry of v.parse(EntrywaysSchema,edgeSection.entryways)){
    const at=entry.portal?.destination.at??entry.at,yaw=entry.portal?.destination.yaw??Math.atan2(at[0],at[2]);
    cameras.push({name:`entry-${entry.edge}`,origin:'entry',eye:[at[0],at[1]+1.7,at[2]],yaw:-yaw*180/Math.PI,pitch:0,fov:93.0105});
  }
  const cameraPath=resolve(root,'art/legacy-goldens/compare/cameras24.json'),cameraBytes=existsSync(cameraPath)?readFileSync(cameraPath):null;
  const catalogue=cameraBytes===null?null:v.parse(cameraCatalogue,JSON.parse(cameraBytes.toString('utf8')));
  for(const row of catalogue?.cameras[product]??[])cameras.push({name:row.name,origin:'declared',eye:row.eye,yaw:row.yaw,pitch:row.pitch,fov:row.fov});
  /** @type {import('./tile-bake-report.mjs').BakePart[]} */const parts=[];
  if(scenesSection!==null)for(const library of v.parse(WorldScenesSchema,scenesSection).libraries)if(library.kind==='whole'&&library.load!=='explorer')for(const model of library.models)parts.push({id:`${library.id}/${model.id}`,files:model.files});
  // Slab rows are interpreted only after the defining section schema admits
  // them. This is a bounded accounting projection, not a new source grammar.
  const slabProjection=v.looseObject({id:v.string(),tiles:v.pipe(v.array(v.looseObject({tile:v.pipe(natural,v.maxValue(63)),files:v.pipe(v.array(v.looseObject({file:v.string(),chunks:v.pipe(v.array(v.looseObject({key:v.union([natural,v.string()]),bytes:natural,box:v.tuple([finite,finite,finite,finite,finite,finite]),geometricError:v.pipe(finite,v.minValue(0))})),v.maxLength(64))})),v.maxLength(16))})),v.maxLength(64))});
  /** @type {import('./tile-bake-report.mjs').BakeChunk[]} */ const chunks=[];
  if(scenesSection!==null)for(const library of v.parse(v.array(v.looseObject({kind:v.string()})),scenesSection.libraries)){
    if(library.kind!=='slabs')continue;
    const slab=v.parse(slabProjection,library);
    for(const tileRow of slab.tiles)for(const file of tileRow.files)for(const chunk of file.chunks)chunks.push({id:`${slab.id}/${tileRow.tile}/${file.file}/${chunk.key}`,tile:tileRow.tile,bytes:chunk.bytes,box:chunk.box,geometricError:chunk.geometricError});
  }
  const report=tileTilingReport({slug:product,...(ring===undefined?{}:{ring}),tiles,cameras,parts,chunks});
  return {...report,provenance:{indexHash:hash(bytes),cameraHash:cameraBytes===null?null:hash(cameraBytes)}};
}
/** Run after the unchanged all-product checkTileBake in every build/reuse.
 * @param {string} root @param {string} product @param {string} folder */
export function reportTileBake(root,product,folder){
  const report=readTilingReport(root,product,folder);
  if(product==='nine-dragon-stack')checkNineTiling(report,JSON.parse(readFileSync(resolve(root,'lint/nine-tiling-baseline.json'),'utf8')));
  console.info(tilingMarkdown(report));return report;
}
