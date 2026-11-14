import { nineNativeConstants } from './fixtures/nine-native-constants';
// @vitest-environment node
import {expect,test} from 'vitest';
import * as v from 'valibot';
import {openFolderSession,type FolderSessionVariant} from './fixtures/headless/folderSession';
import {parseGrappleProfile} from '@wildshard/format/grapple';
import type {HeadlessTapeObservation,HeadlessTapePlan} from '../src/shared/host/headlessTape';

const xyz=v.object({x:v.number(),y:v.number(),z:v.number()});
const payloadSchema=v.object({spawnY:v.number(),hooks:v.array(xyz),grappleProfile:v.unknown()});
const adapterSchema=v.object({sim:v.object({phase:v.string(),target:v.nullable(v.object({landing:xyz,lifts:v.boolean()}))})});
function state(row:HeadlessTapeObservation){
  const adapter=row.adapters[0];if(adapter===undefined)throw new Error('Missing actual grapple owner');
  return v.parse(adapterSchema,JSON.parse(adapter.state));
}
async function hookTape(variant?:FolderSessionVariant){
  const f=await openFolderSession('nine-dragon-stack',variant);
  try{
    const payload=v.parse(payloadSchema,await nineNativeConstants());
    const source=f.product.shardfile.spawn,p={x:source.x,y:Math.max(source.y,payload.spawnY),z:source.z};
    const profile=parseGrappleProfile(payload.grappleProfile).headless;
    // The near eastern ring is visible from the bridge; target the admitted
    // hook itself, not a test pose or a forged lock/landing.
    const hook=payload.hooks.find(row=>row.x>p.x+15&&Math.abs(row.z-p.z)<10&&row.y>p.y+4&&Math.hypot(row.x-p.x,row.z-p.z,row.y-p.y)<38);
    if(hook===undefined)throw new Error('Missing bridge-side declared hook');
    const dx=hook.x-p.x,dz=hook.z-p.z,yaw=Math.atan2(-dx,-dz),pitch=Math.atan2(hook.y-p.y-profile.eye,Math.hypot(dx,dz));
    const player={kind:'player' as const,moveX:0,moveZ:0,yaw};
    const plan:HeadlessTapePlan={version:1,observe:[profile.step],segments:[
      {id:'aim',ticks:1,commands:[player,{kind:'script',actorId:profile.aim,value:pitch}]},
      {id:'lock',ticks:1,commands:[{kind:'script',actorId:profile.lock,value:1}]},
      {id:'fire',ticks:1,commands:[{...player,jump:true}]},
      {id:'bite',ticks:24,commands:[]},{id:'zip',ticks:36,commands:[]},{id:'land',ticks:180,commands:[]},
    ]};
    const report=await f.sim.verbTape(plan),lock=report.observations.find(row=>row.id==='lock'),land=report.observations.at(-1);
    if(lock===undefined||land===undefined)throw new Error('Missing actual lock/landing observations');
    const target=state(lock).sim.target;if(target===null)throw new Error('The real native LOCK did not acquire a ring');
    expect(target.lifts).toBe(false);expect(state(land).sim.phase).toBe('idle');expect(land.grounded).toBe(true);
    expect(Math.hypot(land.position[0]-target.landing.x,land.position[2]-target.landing.z)).toBeLessThan(.8);
    expect(f.sim.quarantined).toBe(false);
    return {peak:Math.max(...report.observations.map(row=>row.peakY)),hook};
  }finally{await f.sim.dispose();}
}

test('QB17 real LOCK and ZIP rise under the ring; the former flat path fails that rule',async()=>{
  const flat=await hookTape('nine-flat'),current=await hookTape();
  expect(flat.peak).toBeLessThan(flat.hook.y-3);
  expect(current.peak).toBeGreaterThan(current.hook.y-3);
  expect(current.peak).toBeLessThan(current.hook.y);
},30_000);

test('the negative native control cannot be used with another product',async()=>{
  await expect(openFolderSession('pine-hollow','nine-flat')).rejects.toThrow('variant does not match product');
});
