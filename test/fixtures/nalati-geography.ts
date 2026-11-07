// oxlint-disable-next-line import/no-nodejs-modules -- Runtime fixture admission avoids a large generated JSON type.
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import type { MapGroundPaint, MapPaletteRow } from '@wildshard/format/minimap';
import { ScalarLatticeSchema } from '@wildshard/format/scalarChannel';

const finite=v.pipe(v.number(),v.finite());
const pair=v.tuple([finite,finite]),rgb=v.tuple([finite,finite,finite]);
const paint:v.GenericSchema<unknown,MapGroundPaint>=v.object({base:rgb,layers:v.array(v.object({
  color:v.union([rgb,v.lazy(()=>paint)]),by:v.picklist(['height','slope','distance','wave']),
  edges:v.exactOptional(pair),gain:v.exactOptional(finite),invert:v.exactOptional(v.boolean()),
  centre:v.exactOptional(v.object({x:finite,z:finite,within:finite})),
  wave:v.exactOptional(v.object({kx:finite,kz:finite,warp:v.exactOptional(pair)})),
}))});
const stroke=v.object({width:finite,style:v.string(),dash:v.exactOptional(pair)});
const palette:v.GenericSchema<unknown,MapPaletteRow>=v.object({ground:paint,
  segments:v.array(v.object({from:pair,to:pair,strokes:v.array(stroke)})),trails:v.array(stroke),
  marks:v.array(v.variant('kind',[
    v.object({kind:v.literal('square'),x:finite,z:finite,half:finite,fill:v.string()}),
    v.object({kind:v.literal('box'),x:finite,z:finite,yaw:finite,width:finite,length:finite,fill:v.string()}),
    v.object({kind:v.literal('ring'),x:finite,z:finite,r:finite,line:finite,stroke:v.string()}),
    v.object({kind:v.literal('dot'),x:finite,z:finite,r:finite,fill:v.string()}),
  ])),pois:v.array(v.object({x:finite,z:finite,label:v.string(),color:v.string()})),
});
const geography=v.object({res:finite,size:finite,seed:finite,map:palette,
  channels:v.object({wet:ScalarLatticeSchema,mapRed:ScalarLatticeSchema,mapGreen:ScalarLatticeSchema,mapBlue:ScalarLatticeSchema})});

/** Independent admitted fixture for map/sampler comparisons, without static JSON inference. */
export function readNalatiGeography():v.InferOutput<typeof geography>{
  const input:unknown=JSON.parse(readFileSync('test/fixtures/nalati-geography-original.json','utf8'));
  return v.parse(geography,input);
}
