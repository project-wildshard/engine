// EG-20: inspect the actual shipped title and grid documents against immutable pins.
// Build all pinned products first. The build is Ring 2; this read has no renderer or UI fixture.
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {bareSlug} from '../src/shared/game/grid/catalogueSlot';

interface Head {slug:string;hash:string}
interface Catalogue {shards:Head[];placements:{slug:string}[];grid:{cells:{slug:string}[]};missing?:string[]}
const directory=process.argv[2];if(directory===undefined)throw new Error('usage: catalogue-all-heads <built-directory>');
const pins=JSON.parse(readFileSync('test/pins/shardfiles.json','utf8')) as {shards:Head[]};
const pinnedCatalogue=JSON.parse(readFileSync('test/pins/catalogue.json','utf8')) as Catalogue;
const html=readFileSync(join(directory,'index.html'),'utf8');
const inline=(id:string):unknown=>{
  const text=new RegExp(`<script type="application/json" id="${id}">([^<]*)</script>`,'u').exec(html)?.[1];
  if(text===undefined)throw new Error(`Build has no ${id}`);
  return JSON.parse(text);
};
const catalogue=JSON.parse(readFileSync(join(directory,'catalogue.json'),'utf8')) as Catalogue;
const embedded=inline('ws-catalogue') as Catalogue,titles=inline('ws-title-rows') as {slug:string}[];
if(JSON.stringify(catalogue)!==JSON.stringify(embedded))throw new Error('First paint and fetched catalogue disagree');
const expected=new Set(pins.shards.map(row=>row.slug));
const census=(name:string,rows:readonly {slug:string}[],unique=false,wanted=expected):void=>{
  const slugs=rows.map(row=>bareSlug(row.slug)),actual=new Set(slugs);
  const missing=[...wanted].filter(slug=>!actual.has(slug)),extra=[...actual].filter(slug=>!wanted.has(slug));
  if(missing.length>0||extra.length>0||unique&&slugs.length!==actual.size)
    throw new Error(`${name}: missing ${missing.join(',')}; extra ${extra.join(',')}; rows ${slugs.length}, heads ${actual.size}`);
  console.log(`${name}: ${actual.size} pinned heads, ${slugs.length} rows`);
};
census('title',titles,true);census('catalogue',catalogue.shards,true);
census('placements',catalogue.placements);
census('grid cells',catalogue.grid.cells,false,new Set(pinnedCatalogue.grid.cells.map(row=>bareSlug(row.slug))));
if((catalogue.missing?.length??0)>0)throw new Error(`Build omitted ${catalogue.missing?.join(',')??''}`);
for(const pin of pins.shards)if(catalogue.shards.find(row=>row.slug===pin.slug)?.hash!==pin.hash)
  throw new Error(`Build has another revision of ${pin.slug}`);
console.log('Every shipped head matches its immutable pin');
