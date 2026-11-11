// EG-18: the same real input suffix after a public save/restore must reach the
// same durable result. No golden state, private field list or fake world.
// oxlint-disable-next-line import/no-nodejs-modules -- Hash the public durable result rather than printing megabyte diffs.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- Read only installed immutable product bytes.
import {readFileSync} from 'node:fs';
import {expect,test} from 'vitest';
import {HeadlessSimulation} from '../src/server/host/headless';
import {createTrustedHeadlessResident} from '../src/server/host/headlessRuntime';
import {loadHeadlessProduct} from '../src/server/host/headlessProduct';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {serializeSimSnapshot,snapshotSimHostBytes} from '../src/shared/engine/sim/snapshot';
import {outputDescriptor} from '../src/shared/game/shardfile/outputDescriptor';
import type {HeadlessCommand} from '../src/shared/host/tickProtocol';
import {builtProduct,runtimeAssets} from './fixtures/engine-lift/product';

const ring=JSON.parse(readFileSync('test/pins/rings.json','utf8')) as {'1':{products:string[];slices:string[]}};
const digest=(text:string):string=>createHash('sha256').update(text).digest('hex');
interface World {step:(command:HeadlessCommand)=>Promise<void>;save:()=>string;close:()=>Promise<void>}
// TEST-SPEED TS11: one Rapier module for the file, as every room shares one; each world still gets its own physics.
let rapierModule:ReturnType<typeof loadRapier>|undefined;
const rapier=():ReturnType<typeof loadRapier>=>rapierModule??=loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
for(const slug of [...ring['1'].products,...ring['1'].slices])test(`a saved ${slug} continues the same real walk`,async()=>{
  const directory=builtProduct(slug==='template'?'_template':slug),product=await loadHeadlessProduct(directory),shard=product.shardfile;
  const descriptor=outputDescriptor(shard);if(descriptor===undefined)throw new Error('No admitted product');
  const declared=shard.runtime===null&&!product.has('sim/runtime-plan');
  const assets=declared?new Map(descriptor.index.files.map(file=>[file.commons===true?`commons:${file.hash}`:file.hash,readFileSync(`${directory}/${file.path}`)])):runtimeAssets(product,directory);
  const open=async(saved?:string):Promise<World>=>{
    if(declared){
      const sim=await HeadlessSimulation.create(shard,assets,saved,{deadline:'advisory'});let current=saved??'';
      return {step:async command=>{current=(await sim.step([{source:'restore-proof',commands:[command]}])).snapshot;},save:()=>current,close:()=>sim.dispose()};
    }
    const live=await createTrustedHeadlessResident({shard,assets,product,rapier:await rapier()},saved);
    return {step:command=>{live.step([command]);return Promise.resolve();},save:()=>serializeSimSnapshot(snapshotSimHostBytes(live.host)),close:()=>{live.dispose();return Promise.resolve();}};
  };
  let straight:World|null=null,restored:World|null=null;
  try {
    straight=await open();
    const command=(tick:number):HeadlessCommand=>({kind:'player',moveX:tick<8?.2:-.2,moveZ:-1,yaw:0,...tick===3?{jump:true}:{}});
    for(let tick=0;tick<8;tick++)await straight.step(command(tick));
    const saved=straight.save();expect(saved.length).toBeGreaterThan(0);
    for(let tick=8;tick<16;tick++)await straight.step(command(tick));
    const expected=digest(straight.save());await straight.close();straight=null;
    restored=await open(saved);for(let tick=8;tick<16;tick++)await restored.step(command(tick));
    expect(digest(restored.save())).toBe(expected);
  } finally {await restored?.close();await straight?.close();}
},10_000);
