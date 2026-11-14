import { nalatiRuntime } from './fixtures/nalati-runtime';
// oxlint-disable-next-line import/no-nodejs-modules -- Verify the registered producer's exact sidecar bytes under Node.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare independent SHA-256 receipts from the original inflated rasters.
import {createHash} from 'node:crypto';
import * as v from 'valibot';
import {expect,test} from 'vitest';
import {SceneFloorSchema} from '@wildshard/format/sceneDressing';
import {readSceneFloors} from '../src/client/game/shardfile/sceneDressing';
import {prepareBinarySources} from '../src/client/game/models/binarySource';
import {createShardFolder} from '../src/shared/game/shardfile/shardFolder';
import {emptyShardfile} from '../src/shared/host/author';
import {Scope} from '../src/shared/engine/app/scope';

const source=v.parse(v.object({places:v.object({rows:v.array(v.object({members:v.array(v.tuple([v.string(),v.object({floors:v.array(SceneFloorSchema)})]))}))})}),
  nalatiRuntime);
const fields=source.places.rows.flatMap(row=>row.members.flatMap(([,member])=>member.floors.filter(floor=>'file'in floor)));

test('the two named floor rasters read their exact blocks, NaN words included',async()=>{
  const scope=new Scope('floor.binary.receipt'),blocks=new Map([0,1].map(index=>[`world/floors/${String(index)}.bin`,Uint8Array.from(readFileSync(`test/fixtures/nalati-floor-original-${String(index)}.bin`))] as const));
  const hashes=new Map([...blocks].map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')]));
  const product=createShardFolder({slug:'floor-place',revision:1,shardfile:emptyShardfile({slug:'floor-place',name:'Floor',author:'Test',revision:1,seed:1}),sections:new Map(),
    files:new Map([...hashes].map(([name,hash])=>[name,{hash,url:name}])),read:hash=>{const entry=[...hashes].find(([,value])=>value===hash),bytes=entry===undefined?undefined:blocks.get(entry[0]);if(bytes===undefined)throw new Error('Missing original floor');return Promise.resolve(bytes);}});
  const files=await prepareBinarySources(product,fields.map(field=>({source:{file:field.file},bytes:field.res*field.res*4})),scope);
  try{
  expect(fields).toHaveLength(2);expect(blocks.size).toBe(2);
  for(const row of fields){
    if(!('file'in row))throw new Error('Missing raw floor');
    const bytes=files.get(row.file);if(bytes===undefined)throw new Error('Missing prepared floor');
    expect(bytes.byteLength).toBe(row.res*row.res*4); expect(bytes).toEqual([...blocks].find(([name])=>name===row.file)?.[1]);
    expect(new Float32Array(bytes.buffer).some(value=>Number.isNaN(value))).toBe(true);
    const [floor]=readSceneFloors([row],files);
    expect(floor).toBeTypeOf('function');
  }
  }finally{scope.dispose();}
});
