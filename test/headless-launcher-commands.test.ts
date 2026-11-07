// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- Real native physics bytes, not a browser or a mock weapon.
import { fillNativeCombatFrame,validateHeadlessCommandOwners } from '@wildshard/engine/host/headlessRuntime';
import { tickCommands,TickCommandSchema,type HeadlessCommand } from '@wildshard/engine/host/tickProtocol';
import { parseItems } from '@wildshard/format/items';
import { readFileSync } from 'node:fs';
import * as v from 'valibot';
import { beforeAll,expect,test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { restoreSimHost } from '../src/server/engine/sim/restore';
import { createNativeCombatFrame,installNativeItems } from '../src/server/game/plugin/nativeItems';
import { loadRapier,type Rapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { pinePin } from './fixtures/engine-lift/pins';
import { SIM_LEVEL } from './fixtures/sim-level/level';
const pineItems = () => pinePin.product.section('combat/items').items;

let rapier:Rapier;
beforeAll(async()=>{rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));});
const item=parseItems(pineItems()).rows.find(row=>row.id==='weapon.crossbow');
if(item?.kind!=='weapon'||item.ranged===undefined||item.profile===undefined)throw new Error('Missing actual Pine launcher');
const policy=item.ranged,profile=item.profile;
const command={kind:'launcher',slot:policy.slot,ads:1,pitch:.4,fire:true} as const;
const level={...SIM_LEVEL,entities:[]};
const savedBolt=v.object({bolts:v.array(v.object({active:v.boolean(),vel:v.tuple([v.number(),v.number(),v.number()])}))});

test('launcher commands are finite, detached, counted and cannot carry ammunition or callbacks',()=>{
  const source:Extract<HeadlessCommand,{kind:'launcher'}>={...command};const copy=tickCommands([{source:'player',commands:[source]}],1);
  source.pitch=0;expect(copy[0]).toMatchObject({pitch:.4});
  for(const bad of [{...command,ads:Number.NaN},{...command,ads:1.1},{...command,pitch:Infinity},{...command,pitch:Math.PI},
    {...command,slot:32},{...command,slot:.5},{...command,ammo:30},{...command,run:()=>undefined},{...command,fire:false}])
    expect(v.safeParse(TickCommandSchema,bad).success).toBe(false);
  expect(()=>tickCommands([{source:'a',commands:[command]},{source:'b',commands:[command]}],1)).toThrow('Aggregate');
});

test('real launcher obeys stow, free aim, consumption, manual reload and actual continuation',()=>{
  const host=createSimHost(level,{rapier}),frame=createNativeCombatFrame();
  const launcher=installNativeItems(host,frame,{kind:'bolt',policy,profile});
  const step=(input:readonly HeadlessCommand[])=>{validateHeadlessCommandOwners(host,input);fillNativeCombatFrame(frame,input);host.step();};
  try {
    const original=launcher.state.quiver;
    step([command]);expect(launcher.state.quiver).toBe(original); // stowed trigger is not authority
    frame.live.add(policy.slot);frame.armed.add(policy.slot);step([command]);
    expect(launcher.state.quiver).toBe(original-1);expect(launcher.state.loaded).toBe(false);
    const flying=v.parse(savedBolt,host.adapters.get(policy.step)?.snapshot()).bolts.find(row=>row.active);
    if(flying===undefined)throw new Error('The actual projectile was not launched');
    expect(flying.vel[1]).toBeGreaterThan(0);expect(flying.vel[2]).toBeLessThan(0);
    step([{kind:'launcher',slot:policy.slot,ads:1,pitch:.4,reload:true}]);
    expect(launcher.state.reloading).toBe(true);
    const checkpoint=snapshotSimHost(host);
    for(let tick=0;tick<180;tick++)step([]);
    expect(launcher.state.loaded).toBe(true);expect(launcher.state.reloading).toBe(false);
    expect(launcher.state.quiver).toBe(original-1); // reload never invents a bolt
    const expected=snapshotSimHost(host),restoredFrame=createNativeCombatFrame();
    const restored=restoreSimHost(level,{rapier},checkpoint,fresh=>{
      installNativeItems(fresh,restoredFrame,{kind:'bolt',policy,profile});restoredFrame.live.add(policy.slot);restoredFrame.armed.add(policy.slot);
    });
    try {for(let tick=0;tick<180;tick++)restored.step();expect(snapshotSimHost(restored)).toEqual(expected);}
    finally{restored.dispose();}
    expect(()=>validateHeadlessCommandOwners(host,[{...command,slot:31}])).toThrow('not installed');
    expect(()=>validateHeadlessCommandOwners(host,[{...command,pitch:Number.NaN}])).toThrow();
    expect(()=>validateHeadlessCommandOwners(host,[{kind:'interact',id:'unknown'}])).toThrow('data-only owner');
  }finally{host.dispose();}
  expect(()=>validateHeadlessCommandOwners(host,[command])).toThrow('not installed');
});
