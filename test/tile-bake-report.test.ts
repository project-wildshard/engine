// oxlint-disable-next-line import/no-nodejs-modules -- Verify real product envelopes in isolated owned scratch folders.
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only files in this test's explicit fixture root.
import {resolve} from 'node:path';
import {afterEach,expect,test} from 'vitest';
import {emptyShardfile} from '../src/shared/host/author';
import {writeOutputProduct} from '../src/sharddev/outputProduct';
import type {Shardfile} from '@wildshard/format/shardSchema';
import {checkTileBake} from '../scripts/tile-bakes.mjs';
import {checkNineTiling,readTilingReport,tileBoxVisible,tileTilingReport,tilingMarkdown,type BakeCamera,type NineTilingBaseline,type TilingInput} from '../scripts/tile-bake-report.mjs';

const owned:string[]=[];
afterEach(()=>{for(const path of owned.splice(0))rmSync(path,{recursive:true});});
function tiles():Shardfile['tiles']{
  return ([0,1] as const).flatMap(lod=>Array.from({length:lod===0?64:16},(_,i)=>{
    const count=lod===0?8:4,size=500/count,x=i%count,z=Math.floor(i/count);
    return {lod,x,z,files:[],bounds:{min:[-250+x*size,0,-250+z*size] as [number,number,number],max:[-250+(x+1)*size,0,-250+(z+1)*size] as [number,number,number]},geometricError:0,decoded:0,gpu:0,compressed:0,triangles:0,draws:0};
  }));
}
const camera:BakeCamera={name:'forward',origin:'declared',eye:[0,0,0],yaw:0,pitch:0,fov:60};
function input():TilingInput{return {slug:'nine-dragon-stack',ring:'cell',tiles:tiles(),cameras:[],parts:[],chunks:[]};}
const baseline:NineTilingBaseline={version:1,product:'nine-dragon-stack',ring:'cell',chunks:{bytes:4_000_000},tileDebt:{}};

test('A/D keep exact costs, legal zero error and inclusive cap boundaries; one extra unit is flagged',()=>{
  const source=input(),row=source.tiles[0];if(row===undefined)throw new Error('Missing first tile');
  Object.assign(row,{decoded:2_000_000,gpu:2_000_000,compressed:12,triangles:40_000,draws:8});row.bounds.max[1]=125;
  const exact=tileTilingReport(source);expect(exact.tiles[0]?.over).toEqual([]);expect(exact.tiles[0]?.tall).toBe(false);expect(exact.zeroError).toBe(1);expect(exact.l0).toEqual({gpu:2_000_000,resident:4_000_000,compressed:12,triangles:40_000,draws:8,occupied:1});
  expect(()=>checkNineTiling(exact,baseline)).not.toThrow();
  row.decoded++;row.triangles++;row.draws++;
  const over=tileTilingReport(source);expect(over.tiles[0]?.over).toEqual(['resident','triangles','draws']);expect(over.overCaps).toBe(1);
  expect(()=>checkNineTiling(over,baseline)).toThrow('regression');
  expect(tilingMarkdown(over)).toContain('genuinely lossless zero is legal');expect(tilingMarkdown(over)).toContain('A ·');expect(tilingMarkdown(over)).toContain('B ·');expect(tilingMarkdown(over)).toContain('D ·');
});

test('frustum orientation uses actual yaw/pitch and full3D box distance, including vertical separation',()=>{
  const ahead={min:[-1,-1,-20],max:[1,1,-18]},behind={min:[-1,-1,18],max:[1,1,20]};
  expect(tileBoxVisible(ahead,camera)).toBe(true);expect(tileBoxVisible(behind,camera)).toBe(false);
  expect(tileBoxVisible({min:[18,-1,-1],max:[20,1,1]},{...camera,yaw:90})).toBe(true);
  expect(tileBoxVisible({min:[-1,18,-1],max:[1,20,1]},{...camera,pitch:90})).toBe(true);
  const source=input(),row=source.tiles.find(t=>t.lod===0&&t.x===3&&t.z===3);if(row===undefined)throw new Error('Missing tile');
  row.gpu=5_000_000;row.triangles=100;source.cameras=[{...camera,eye:[-1,100,-1],pitch:-90}];
  const report=tileTilingReport(source),view=report.sightlines[0];expect(view?.minDistance).toBe(100);expect(view?.heavy[0]?.distance).toBe(100);expect(view?.heavy[0]?.metresPerPixel).toBeCloseTo(100*2*Math.tan(Math.PI/6)/1748,12);
});

test('sightline cutoff is strictly20percent; spanning counts one part only above4tiles',()=>{
  const source=input(),far=source.tiles.find(t=>t.lod===0&&t.x===0&&t.z===0),near=source.tiles.find(t=>t.lod===0&&t.x===5&&t.z===0);
  if(far===undefined||near===undefined)throw new Error('Missing tiles');far.triangles=20;near.triangles=80;
  source.cameras=[{...camera,eye:[240,0,-240],yaw:-90,fov:100}];
  let report=tileTilingReport(source);expect(report.sightlines[0]?.fraction).toBe(.2);expect(report.over20).toBe(0);expect(report.cut).toBe(1);
  far.triangles++;report=tileTilingReport(source);expect(report.over20).toBe(1);
  for(const row of source.tiles.filter(t=>t.lod===0).slice(0,5))row.files=['a'.repeat(64)];
  source.parts=[{id:'tower',files:['a'.repeat(64)]}];expect(tileTilingReport(source).spanning).toEqual([{id:'tower',tiles:5}]);
  const first=source.tiles[0];if(first===undefined)throw new Error('Missing first tile');first.files=[];expect(tileTilingReport(source).spanning).toEqual([]);
});

test('Nine-only baseline is exact by coordinate and ring; other advisory shards cannot fail it',()=>{
  const source=input(),row=source.tiles[0];if(row===undefined)throw new Error('Missing first tile');row.decoded=4_000_001;
  const allowed={...baseline,tileDebt:{'0/0/0':{resident:4_000_001,triangles:0,draws:0}}};
  expect(()=>checkNineTiling(tileTilingReport(source),allowed)).not.toThrow();row.decoded++;expect(()=>checkNineTiling(tileTilingReport(source),allowed)).toThrow('regression');
  expect(()=>checkNineTiling({...tileTilingReport(source),slug:'other'},null)).not.toThrow();
  const plain=input();delete plain.ring;expect(()=>checkNineTiling(tileTilingReport(plain),baseline)).toThrow('ring');
  expect(()=>checkNineTiling(tileTilingReport(input()),{...baseline,extra:true})).toThrow();
});

test('new chunk bytes refuse only above4MB; oversized3Dheight is reported without falsifying original geometry',()=>{
  const source=input();source.chunks=[{id:'slab',tile:0,bytes:4_000_000,box:[0,0,0,1,130,1],geometricError:0}];
  let report=tileTilingReport(source);expect(()=>checkNineTiling(report,baseline)).not.toThrow();expect(tilingMarkdown(report)).toContain('130');
  const chunk=source.chunks[0];if(chunk===undefined)throw new Error('Missing chunk');chunk.bytes++;report=tileTilingReport(source);expect(()=>checkNineTiling(report,baseline)).toThrow('chunk');
  chunk.box[4]=-1;expect(()=>tileTilingReport(source)).toThrow('bounds');
});

test('thin far level cutoff is strictly5percent and malformed cameras refuse',()=>{
  const source=input(),fine=source.tiles[0],coarse=source.tiles.find(t=>t.lod===1);if(fine===undefined||coarse===undefined)throw new Error('Missing levels');
  fine.triangles=100;coarse.triangles=5;expect(tileTilingReport(source).thin).toBe(false);coarse.triangles=4;expect(tileTilingReport(source).thin).toBe(true);
  source.cameras=[{...camera,fov:Number.NaN}];expect(()=>tileTilingReport(source)).toThrow();
});

test('hold-cell advice distinguishes dense vertical content from small spread-out sightline warnings',()=>{
  const source=input(),fine=source.tiles.filter(row=>row.lod===0).slice(0,10);
  for(const [i,row] of fine.entries()){row.gpu=i<5?160_000:40_000;row.triangles=100;row.bounds.max[1]=126;}
  source.cameras=[{...camera,eye:[240,0,-240],yaw:-90,fov:100}];
  let report=tileTilingReport(source);expect(report.topFiveShare).toBe(.8);expect(report.over20).toBeGreaterThan(0);expect(report.verdict).not.toContain('hold the cell');
  const first=fine[0];if(first===undefined)throw new Error('Missing first tile');first.gpu++;
  report=tileTilingReport(source);expect(report.verdict).toContain('hold the cell');
  for(const row of fine)row.bounds.max[1]=125;
  report=tileTilingReport(source);expect(report.verdict).not.toContain('hold the cell');expect(report.over20).toBeGreaterThan(0);
});

test('verified reader refuses tampered section/envelope bytes and old all-product debt guard remains independent',()=>{
  mkdirSync('tmp',{recursive:true});const root=resolve(mkdtempSync('tmp/nt7-report-'));owned.push(root);
  mkdirSync(resolve(root,'art/legacy-goldens/compare'),{recursive:true});writeFileSync(resolve(root,'art/legacy-goldens/compare/cameras24.json'),JSON.stringify({cameras:{}}));
  mkdirSync(resolve(root,'lint'));writeFileSync(resolve(root,'lint/tile-bake-debt.json'),JSON.stringify({version:1,products:{}}));
  const source=emptyShardfile({slug:'other',name:'Report',author:'Test',seed:1,revision:1});source.tiles=tiles();
  const folder=resolve(root,'out/other');writeOutputProduct(source,new Map(),folder);
  const indexBytes=readFileSync(resolve(folder,'shard.json'));
  expect(readTilingReport(root,'other',folder).l0.occupied).toBe(0);
  const first=source.tiles[0];if(first===undefined)throw new Error('Missing first tile');first.compressed=300_001;
  writeOutputProduct(source,new Map(),folder);expect(()=>readTilingReport(root,'other',folder)).not.toThrow();expect(()=>checkTileBake(root,'other',folder)).toThrow('tile bake refused');
  writeFileSync(resolve(folder,'sections/world/tiles.json'),'{}');expect(()=>readTilingReport(root,'other',folder)).toThrow('hash/size');
  writeFileSync(resolve(folder,'shard.json'),indexBytes);expect(()=>readTilingReport(root,'other',folder)).toThrow('receipt');
});
