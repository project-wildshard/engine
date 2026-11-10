import {afterAll,expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the committed pin list and the products `pnpm pins` installed from it.
import {existsSync,readFileSync,readdirSync} from 'node:fs';
import {builtProduct} from './fixtures/builtProduct';
import {shippedGraphCosts,type ShippedGraphCost} from './fixtures/shipped-graph-costs';

// CI21 (J232): engine holds no shard source now; every shipped product it reads is a pinned one (`pnpm pins`).
// A product is served from its own folder, which isn't always its slug, so read the installed folders' pin receipts.
const pins=JSON.parse(readFileSync('test/pins/shardfiles.json','utf8')) as {shards:{slug:string;hash:string}[]};
const pinned=new Set(pins.shards.map(pin=>pin.hash));
const installed=(existsSync('out')?readdirSync('out'):[]).filter(folder=>existsSync(`out/${folder}/validation.json`))
 .map(folder=>({folder,slug:(JSON.parse(readFileSync(`out/${folder}/shard.json`,'utf8')) as {identity:{slug:string}}).identity.slug,
  hash:(JSON.parse(readFileSync(`out/${folder}/validation.json`,'utf8')) as {pin?:{hash?:string}}).pin?.hash??''}))
 .filter(row=>pinned.has(row.hash)).sort((a,b)=>a.slug.localeCompare(b.slug));
// A product is read from its folder and reports its own slug (`out/_template` holds `template`).
const products=installed.map(({folder,slug})=>({folder,slug})),reports:ShippedGraphCost[]=[];
test('the census covers every pinned shipped product',()=>{expect(new Set(installed.map(row=>row.hash))).toEqual(pinned);expect(installed).toHaveLength(pinned.size);});
for(const {folder,slug} of products)test(`emitted shader work for every admitted graph in ${slug}`,async()=>{
 const rows=await shippedGraphCosts(builtProduct(folder));
 expect(new Set(rows.map(row=>row.graphHash)).size).toBe(rows.length);
 for(const row of rows){
  expect(row.slug).toBe(slug);expect(row.aliases.length).toBeGreaterThan(0);
  if(row.kind==='post')expect(row.postFragmentShaderHash).toMatch(/^[a-f0-9]{64}$/u);
  else expect(row.postFragmentShaderHash).toBeNull();
  if(row.kind==='fog')expect(row.fragmentShaderHashes).toEqual({main:null,outline:null});
  else expect(row.fragmentShaderHashes.main).toMatch(/^[a-f0-9]{64}$/u);
  if(row.selectedFogGraphHash!==null)expect(rows.find(candidate=>candidate.graphHash===row.selectedFogGraphHash)?.kind).toBe('fog');
  for(const program of Object.values(row.execution))if(program!==null)for(const stage of Object.values(program))for(const value of Object.values(stage)){
   expect(Number.isSafeInteger(value)).toBe(true);expect(value).toBeGreaterThanOrEqual(0);
  }
 }
 reports.push(...rows);
 console.info(JSON.stringify({g3:'shipped-graph-cost',slug,graphs:rows}));
});
afterAll(()=>{
 const top=reports.filter(row=>row.execution.main!==null).map(row=>({slug:row.slug,graphHash:row.graphHash,aliases:row.aliases,fragment:row.execution.main?.fragment,lighting:{sun:row.execution.main?.sun,ambient:row.execution.main?.ambient,grade:row.execution.main?.grade}}))
  .sort((a,b)=>(b.fragment?.unconditional??0)-(a.fragment?.unconditional??0)).slice(0,10);
 console.info(JSON.stringify({g3:'static-top-ten',products:products.map(row=>row.slug),graphs:reports.length,ranking:'unconditional fragment-main estimates per invocation; not pixel-weighted',pixelCoverage:'not supplied: G1 measured draw coverage is required',top}));
});
