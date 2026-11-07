import * as v from 'valibot';
import {EquipmentService} from '../../src/client/engine/combat/EquipmentService';
import {Weapon,type EquipmentView,type WeaponState} from '../../src/shared/engine/combat/Weapon';
import type {EquipmentRow} from '../../src/shared/engine/combat/Equipment';
import {enterPracticeLoan,exitPracticeLoan,practiceViewDistance} from '../../src/client/engine/practice/practiceLoan';
import {ARENA_LINEUP} from '../../src/client/engine/practice/lineup';
import {fovForAspect} from '../../src/shared/engine/combat/blocks/melee';
import {practiceRoomState} from '../../src/shared/engine/core/practiceRoomState';
import {parseHeldSlots} from '@wildshard/format/heldArms';
import {ItemCatalogue} from '../../src/shared/game/loadout/itemCatalogue';
import type {PrepareHeadlessRuntime} from '../../src/server/host/headlessRuntime';
import {prepareProductPlan as prepareNalati} from './headless-native';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/** The inventory port borrows admitted equipment identities only. Weapon
 * arithmetic belongs to the separate real combat proofs, never this owner. */
class LoanInventorySlot extends Weapon {
  readonly model:EquipmentView={visible:false,parent:null,removeFromParent:()=>undefined};
  get state():WeaponState{throw new Error('Inventory-only practice proof has no ammunition authority');}
  adsHeld=false;aimInfo=null;enabled=false;holster=0;
  tryFire():void{throw new Error('Inventory-only practice proof cannot execute firing');}
  override reload():void{throw new Error('Inventory-only practice proof cannot execute reloading');}
  update():void{/* Selection and loan ownership are advanced by the actual EquipmentService. */}
}
const finite=v.pipe(v.number(),v.finite());
const Op=v.picklist(['enter','exit','swap','rifle']);
const Frame=v.strictObject({ops:v.pipe(v.array(Op),v.maxLength(4)),dt:v.pipe(finite,v.minValue(0),v.maxValue(1)),t:finite});
const Saved=v.strictObject({version:v.literal(1),frames:v.pipe(v.array(Frame),v.maxLength(1200)),state:v.unknown()});

/** Real room loan/selection calls over the admitted arsenal. The native room
 * spawn goes through the shared entry kernel; no input supplies a pose, slot
 * grant or ammo. Room/dummy collision and firearm shots are not implemented. */
export const prepareHeadlessRuntime:PrepareHeadlessRuntime=async preparation=>{
  const base=await prepareNalati(preparation),slots=parseHeldSlots(await preparation.product.json('held/slots.json'));
  const catalogue=new ItemCatalogue(preparation.shard.items),rows=new Map(slots.slots.filter(row=>row.kind!=='tool').map(row=>[row.id,catalogue.equipment(row.item)]));
  const primary=rows.get(slots.equipment.primary),rifle=slots.equipment.rifle===undefined?undefined:rows.get(slots.equipment.rifle);
  if(primary?.legacySlot===undefined||rifle?.legacySlot===undefined)throw new Error('Practice proof requires the admitted primary and rifle');
  const rifleId=rifle.legacySlot;
  const need=(id:string):EquipmentRow=>{const row=rows.get(id);if(row?.legacySlot===undefined)throw new Error('Missing declared practice slot');return row;};
  const order=slots.equipment.order?.map(id=>{const idOf=need(id).legacySlot;if(idOf===undefined)throw new Error('Missing ordered practice slot');return idOf;});
  return {...base,install:(host,context)=>{
    base.install(host,context);
    let open=false,pitch=0;
    const baseline=practiceRoomState.open;
    const make=():EquipmentService=>{
      const service=new EquipmentService(new LoanInventorySlot(primary),{scope:host.scope,...(order===undefined?{}:{order:[...order]})});
      const ids=[...slots.equipment.rifle===undefined?[]:[slots.equipment.rifle],...slots.equipment.extras,
        ...slots.equipment.secondary===undefined?[]:[slots.equipment.secondary]];
      for(const id of ids)service.add(new LoanInventorySlot(need(id)),{locked:true});
      for(const id of slots.selection.unlock){const slot=need(id).legacySlot;if(slot===undefined)throw new Error('Missing initial practice slot');service.unlock(slot);}
      if(slots.selection.initial!==undefined){const slot=need(slots.selection.initial).legacySlot;if(slot===undefined)throw new Error('Missing selected practice slot');service.select(slot,true);}
      return service;
    };
    let equipment=make();
    const frames:v.InferOutput<typeof Frame>[]=[];
    const player={setHover:(on:boolean)=>{leadPlayer(host).setBoard(on);},spawn:(x:number,z:number,yaw:number,y=0)=>{leadPlayer(host).resetPose({x,y,z},yaw);},
      get pitch(){return pitch;},set pitch(value:number){pitch=value;}};
    const centre=ARENA_LINEUP[1];if(centre===undefined)throw new Error('Missing actual practice lineup');
    // Initial bow hip uses the page's 72-degree ranged base before Hor+.
    const width=402,aspect=width/874,fov=fovForAspect(72,aspect);
    const at={x:preparation.shard.spawn.x,z:preparation.shard.spawn.z+centre.z+practiceViewDistance(fov,aspect,width),y:900};
    const apply=(op:v.InferOutput<typeof Op>,restoring:boolean):void=>{
      if(op==='enter'){
        if(restoring){equipment.lendAll();equipment.select(equipment.list[0]?.id??equipment.current.id,true);pitch=-.1;}
        else enterPracticeLoan({weapons:equipment,player},at);
        open=true;
      }else if(op==='exit'){exitPracticeLoan(equipment);open=false;}
      else if(op==='swap')equipment.swap();
      else equipment.select(rifleId);
      practiceRoomState.open=open;
      if(!restoring&&(op==='enter'||op==='exit'))host.events.emit('practice.active',open);
    };
    const state=()=>({open,pitch,current:equipment.current.row.id,available:equipment.available.map(weapon=>weapon.row.id),
      swapping:equipment.swappingNow,slots:equipment.list.map(weapon=>({id:weapon.row.id,held:weapon===equipment.current,enabled:weapon.enabled,holster:weapon.holster})),
      rifle:rifle.id,at,board:leadPlayer(host).board.on});
    host.onStep('nalati.practice',(dt)=>{
      const ops:v.InferOutput<typeof Op>[]=[];
      for(const command of context.commands()){
        if(command.kind==='launcher'||command.kind==='player'&&(command.attack!==undefined||command.heavy!==undefined))throw new Error('Inventory-only practice proof cannot execute firing');
        if(command.kind!=='script'||!command.actorId.startsWith('nalati.practice.'))continue;
        if(command.value!==1)throw new Error('Invalid practice input');
        const op=v.parse(Op,command.actorId.slice('nalati.practice.'.length));ops.push(op);apply(op,false);
      }
      if(frames.length>=1200||ops.length>4)throw new Error('Practice inventory proof allowance exceeded');
      const frame={ops,dt,t:host.clock.now};equipment.update(dt,frame.t);frames.push(frame);
    },{snapshot:()=>JSON.stringify({version:1,frames,state:state()}),restore:input=>{
      const saved=v.parse(Saved,typeof input==='string'?JSON.parse(input):input);
      equipment.dispose();equipment=make();open=false;pitch=0;frames.length=0;
      for(const frame of saved.frames){for(const op of frame.ops)apply(op,true);equipment.update(frame.dt,frame.t);frames.push(structuredClone(frame));}
      if(JSON.stringify(state())!==JSON.stringify(saved.state))throw new Error('Practice inventory continuation differs from its accepted inputs');
    }},'afterBodies');
    host.scope.onDispose(()=>{equipment.dispose();practiceRoomState.open=baseline;});
  }};
};
