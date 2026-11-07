import { originalSpeciesJson } from './nalati-original-species';
// Frozen pre-migration native envelope; production never imports this fixture.
import type * as THREE from 'three';
import type { Animal } from '@wildshard/engine/entities/AnimalView';
import type { SpeciesDef,ThinkCtx } from '@wildshard/engine/entities/species/registry';
import * as v from 'valibot';
import { app } from '@wildshard/engine/app/runtime';
import { ANIMAL_STATES } from '@wildshard/engine/entities/animalStates';
import type { DamageRequest } from '@wildshard/engine/combat/pipeline';
import { StrikeRunner } from '@wildshard/engine/ai/strikes';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import { CreatureGuestSchema, type CreatureGuestRows } from '@wildshard/format/speciesBookRows';
import { ReturnProgram } from '@wildshard/engine/game/population/returnProgram';
import generated from './originalBalbalRows.json' with { type: 'json' };
// The unchanged ABI1 artifact is the oracle even after the production guest selects ABI2.
function speciesGuestRows(): CreatureGuestRows { return v.parse(CreatureGuestSchema, generated); }

const speciesRows = v.parse(v.object({ balbal: v.object({ kind: v.string() }) }), originalSpeciesJson('boot.json'));
export const BALBAL = speciesRows.balbal.kind;
let admitted:CreatureGuestRows|null=null;
let strike:ReturnType<typeof strikeFromData>|null=null;
const contacts=new StrikeRunner();
function guestRows():CreatureGuestRows{
  if(admitted!==null)return admitted;
  const row=speciesGuestRows();
  if(row.states.some(state=>!ANIMAL_STATES.some(value=>value===state)))throw new Error('Unknown creature state');
  admitted=row;return row;
}
/** Bind the original native strike before publishing the shared program. */
export function program():ReturnProgram{nativeStrike();return ReturnProgram.page(guestRows().program,app.levelScope??undefined);}
function nativeStrike():ReturnType<typeof strikeFromData>{strike??=strikeFromData(guestRows().strike);return strike;}
  /** A geometric observation shared by damage and local hit presentation. */
function weakPoint(actor:Animal,point:THREE.Vector3):boolean{
    const yaw=-actor.yaw;
    return program().project('weakPoint',{x:actor.position.x,ay:actor.position.y,z:actor.position.z,
      cos:Math.cos(yaw),sin:Math.sin(yaw),scale:actor.scale,yOffset:actor.yOffset,hitX:point.x,hitY:point.y,hitZ:point.z})['weakPoint']===1;
  }
function think(actor:Animal,context:ThinkCtx):void{
    const row=guestRows(),memory=actor.mem,previous=memory[row.clock],dt=previous===undefined?context.dt:context.t-previous;
    if(previous!==undefined&&dt<.1-1e-9)return;
    const observed:Record<string,number>={};
    for(const [key,field]of Object.entries(row.memory))observed[key]=memory[key]??(field.when!==undefined&&memory[field.when.field]===field.when.equal?field.when.value:field.source===undefined?field.value:field.source==='yaw'?actor.yaw:actor.position[field.source]);
    const bearing=Math.atan2(context.player.x-actor.position.x,context.player.z-actor.position.z),wrap=(angle:number)=>Math.atan2(Math.sin(angle),Math.cos(angle));
    const answer=program().project('think',{...observed,bearing,homeBearing:Math.atan2((observed['homeX']??actor.position.x)-actor.position.x,(observed['homeZ']??actor.position.z)-actor.position.z),
      homeOff:wrap((observed['homeYaw']??actor.yaw)-actor.yaw),hitOff:wrap(bearing-actor.yaw),dt,px:context.player.x,py:context.player.y,pz:context.player.z,
      x:actor.position.x,ay:actor.position.y,z:actor.position.z,yaw:actor.yaw,state:row.states.indexOf(actor.state),calm:Number(context.calm),attack:actor.attackPhase,
      bounds:Number(['minX','maxX','minZ','maxZ'].every(key=>memory[key]!==undefined)),scale:actor.scale});
    const out=(key:string):number=>{const value=answer[key];if(value===undefined)throw new Error('Missing creature decision output');return value;};
    for(const key of row.writes)memory[key]=out(key);
    memory['init']=1;memory[row.clock]=context.t;memory[row.playerKeys[0]]=context.player.x;memory[row.playerKeys[1]]=context.player.z;
    actor.position.x=out('x');actor.position.z=out('z');actor.lookTarget.copy(context.player);actor.lookWeight=out('look');
    const state=ANIMAL_STATES.find(value=>value===row.states[out('state')]);if(state!==undefined)actor.state=state;
    if(out('start')===1)actor.startAttack(row.attack);
    if(out('motion')===1){if(out('path')===1)context.steer(actor,out('yaw'),out('speed'),out('turn'));else actor.setMotion(out('yaw'),out('speed'),out('turn'));}
    if(out('cancel')===1)actor.cancelAttack();
    if(out('strike')===1){
      const shape=nativeStrike().shape;if(shape.kind!=='wedge')throw new Error('Guest contact needs an admitted wedge');
      contacts.contact({...nativeStrike(),shape:{...shape,length:row.length[0]*actor.scale/row.length[1]+row.length[2]}},{actor,target:context.player,canReach:()=>context.reach(actor),hit:()=>{context.hurt(out('damage'));}});context.sound(row.strikeSound);
    }
    const sound=row.sounds[out('sound')];if(sound!==undefined&&sound!=='')context.sound(sound);
  }
function damage(actor:Animal,point:THREE.Vector3,_direction:THREE.Vector3,request:DamageRequest|undefined):number{
    const row=guestRows(),equipment=app.equipment,id=equipment!==null&&equipment.visible&&!equipment.stowed?equipment.current.row.id:'';
    const piercing=request===undefined||request.sourceTags.some(tag=>tag===row.piercing.legacy)?row.piercing.equipment.includes(id):request.sourceTags.some(tag=>row.piercing.tags.includes(tag));
    return v.parse(v.pipe(v.number(),v.finite()),program().project('damage',{field:actor.mem['field']??0,rise:actor.mem['rise']??1,open:actor.mem['open']??0,
      range:Math.hypot(point.x-(actor.mem[row.playerKeys[0]]??0),point.z-(actor.mem[row.playerKeys[1]]??0)),piercing:Number(piercing),crack:Number(weakPoint(actor,point))})['damage']);
  }
/** The balbals' page controls; their body, rig, look, cracks and frame are the look book's rows. */
export const BALBAL_SPECIES: Pick<SpeciesDef, 'kind' | 'think' | 'damageMul'> = {
  kind: BALBAL,
  think,
  damageMul: damage,
};
