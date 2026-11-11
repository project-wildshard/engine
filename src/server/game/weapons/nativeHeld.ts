/** The held arms of a riding world: bow, blade and polearm, a seat for each player (P1-E3.5). Actual held inputs and admitted
 *  rows, sharing the page's decisions, base pose, contact sweeps and projectile laws. No target is created. A tape's lone player
 *  keeps the owner's exact continuation; only a net room's commands reach it as attacks, equips and launchers. */
import * as v from 'valibot';
import { Vector3, Quaternion, Euler, MathUtils } from 'three';
import { BowDraw } from '@wildshard/engine/combat/bowDraw';
import { bowBlocked, bowAimOn, bowMount, bowLooseSpreadDegrees, bowLaunchSpeed, bowMuzzle, type BowMountState } from '@wildshard/engine/combat/bowLaw';
import { ProjectileLaw } from '@wildshard/engine/combat/projectileLaw';
import { shotSpread } from '@wildshard/engine/combat/shotSpread';
import { SweptMeleeCore, sweptLunge, sweptMoveDamage } from '@wildshard/engine/combat/sweptMeleeCore';
import { SweptBasePose } from '@wildshard/engine/combat/sweptBasePose';
import { BladeSweep, bladeInReach, sweptBladeDirs, type BladeKey } from '@wildshard/engine/combat/sweptBlade';
import { pickLunge, targetRadius } from '@wildshard/engine/combat/lungeTarget';
import { bladeBlocked } from '@wildshard/engine/player/MeleeSweep';
import { worldHit, floorBelow } from '@wildshard/engine/physics/query';
import { Wind } from '@wildshard/engine/world/steppeWind';
import { WindStateSchema, WeatherWorldSchema } from '@wildshard/format/weatherProgram';
import { MeleeWeaponProfileSchema, ThrownWeaponProfileSchema, HeldBowFileSchema } from '@wildshard/format/weaponProfiles';
import { BladeRowsSchema, PolearmRowsSchema, type BladeRows } from '@wildshard/format/heldMelee';
import { parseHeldSlots } from '@wildshard/format/heldArms';
import { ClientPlanSchema } from '@wildshard/format/clientPlan';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { TargetAnimal, TargetHit } from '@wildshard/engine/combat/types';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { publishOwned } from '@wildshard/engine/sim/shardRows';
import { filterCombatAimTargets } from '../../../shared/game/shardfile/aimTargetFilter';
import { heldBowBase } from '../../../shared/game/weapons/heldBowBase';
import { HeldDecision } from '../../../shared/game/weapons/heldDecision';
import { JavelinFlight, type JavelinSlot } from '../../../shared/game/weapons/javelinFlight';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { SWORD_WOOD } from '../../../shared/game/weapons/starterMeleeProfile';
import { MountedPassLaw } from '../../../shared/game/weapons/mountedPass';
import { PolearmDecision } from '../../../shared/game/weapons/polearmDecision';
import { PolearmContact } from '../../../shared/game/weapons/polearmContact';
import { nativeRangedHit, otherCombatFrame, type NativeCombatFrame } from '../plugin/nativeItems';
import { playerSeats, type PlayerSeat, type PlayerSeats } from '../plugin/playerSeats';
import { mountedPlayerOf } from '../riding/native';
import { nativePopulationOf } from '../riding/nativePopulation';
import { nativeTamingOf } from '../riding/nativeTaming';
import { OWNED_ROW } from '../../../shared/game/loot/ownedRows';

const finite=v.pipe(v.number(),v.finite()),count=v.pipe(finite,v.integer(),v.minValue(0)),vector=v.tuple([finite,finite,finite]);
const SwingSaved=v.strictObject({move:v.nullable(count),swingT:finite,comboIdx:count,lastSwingEnd:finite,cooldown:finite,
  charging:v.boolean(),chargeT:finite,releaseQueued:v.boolean(),chargePending:v.boolean(),heldPrev:v.boolean(),time:finite});
const DrawSaved=v.strictObject({drawT:finite,holdT:finite,renockT:finite,tiredT:finite,wasHeld:v.boolean(),needLift:v.boolean(),reachedFull:v.boolean()});
const poseVector=v.tuple([finite,finite,finite,finite,finite,finite,finite]);
/** The weather owner's wind, as each seat copies it every tick (MMO-PLAN MP1.2: one schema, not one a seat a tick). */
const OWNER_WIND=v.object({wind:WindStateSchema});
const BladeSaved=v.strictObject({pose:v.strictObject({from:poseVector,base:poseVector,chargeBlend:finite,sprintBlend:finite}),
  grip:vector,tip:vector,have:v.boolean(),struck:v.array(v.string()),contacts:count});
const Saved=v.strictObject({version:v.literal(1),enabled:v.optional(v.boolean(),true),slot:v.string(),queued:v.boolean(),aim:finite,pitch:finite,ammo:count,
  draw:DrawSaved,bolts:count,shots:count,letdowns:count,fullDraws:count,aimOn:v.boolean(),aimBlend:finite,
  moves:v.pipe(v.array(v.string()),v.maxLength(64)),passes:count,passDamage:finite,swing:v.unknown(),pass:v.unknown(),cadence:finite,
  thrusts:count,throws:count,recovered:count,polearm:v.unknown(),blade:BladeSaved,
  flying:v.array(v.strictObject({active:v.boolean(),age:finite,glanced:v.boolean(),pos:vector,vel:vector,origin:vector,scale:finite})),stopped:v.unknown(),
  javelins:v.array(v.strictObject({state:v.picklist([0,1,2]),age:finite,pos:vector,vel:vector,q:v.tuple([finite,finite,finite,finite])}))});

/** One tick command, as these arms read it. */
export interface HeldCommand { readonly kind: string; readonly actorId?: string; readonly playerId?: string; readonly value?: number; readonly attack?: unknown; readonly heavy?: unknown;
  readonly swing?: boolean; readonly pitch?: number; readonly ads?: number; readonly seq?: number }
/** The tick's commands: the first player's list, then each other player's. */
export interface HeldTick { readonly commands: () => readonly HeldCommand[]; readonly commandsOf: (id: string) => readonly HeldCommand[] }
/** The assembly row, with its weather rows read. */
export interface HeldArmsRow { readonly step: string; readonly slots: string; readonly weather: unknown; readonly input: { readonly attack: string; readonly swap: string; readonly aim: string; readonly pitch: string } }
export type HeldRay = (host: SimHost, from: Vector3, direction: Vector3, distance: number, hit: ReturnType<typeof nativeRangedHit>) => ReturnType<typeof nativeRangedHit>;
/** An encounter lends its actual target and continuation identity. Ordinary animal/spear keys remain roster-owned; this port affects arrows only. */
export interface HeldArrowTargets {
  readonly ray: (host: SimHost, from: Vector3, direction: Vector3, distance: number, hit: TargetHit | null) => TargetHit | null;
  readonly key: (host: SimHost, target: TargetAnimal) => string | null;
  readonly resolve: (host: SimHost, key: string) => TargetAnimal | null;
}
/** What an encounter may do to one player's arms. */
export interface HeldSeat extends PlayerSeat { readonly setEnabled: (on: boolean) => void; readonly refill: () => void; readonly arrows: () => number; readonly look: { yaw: number; pitch: number } }
/** What a world lends these arms. */
export interface HeldArmsContext { readonly combat: NativeCombatFrame; readonly room?: boolean | undefined; readonly tick: HeldTick; readonly contacts?: HeldRay | undefined; readonly arrowTargets?: HeldArrowTargets | undefined }
const owners = new WeakMap<SimHost, PlayerSeats<HeldSeat>>();
/** This host's arms, a seat for each player. */
export function heldArmsOf(host: SimHost): PlayerSeats<HeldSeat> | undefined { return owners.get(host); }

/** Read the arms' rows now; the returned step installs them on one host. */
export async function prepareHeldArms(product: Pick<ShardProduct, 'json' | 'section' | 'shardfile'>, arms: HeldArmsRow): Promise<(host: SimHost, context: HeldArmsContext) => void> {
  const slots=parseHeldSlots(await product.json(arms.slots));
  const aimRows=v.parse(ClientPlanSchema,product.section('client/plan')).features.find(row=>row.kind==='combat.targets')?.rows.aim;
  if(aimRows===undefined)throw new Error('Weapons require their admitted aim exclusions');
  const bowSlot=slots.slots.find(row=>row.kind==='bow'),bladeSlot=slots.slots.find(row=>row.kind==='blade'),spearSlot=slots.slots.find(row=>row.kind==='polearm');
  if(bowSlot?.kind!=='bow'||bladeSlot?.kind!=='blade'||spearSlot?.kind!=='polearm'||bladeSlot.source.kind!=='passes')throw new Error('Missing admitted native weapon slots');
  const blade=v.parse(BladeRowsSchema,await product.json(bladeSlot.source.file)),spear=v.parse(PolearmRowsSchema,await product.json(spearSlot.file));
  const definition=v.parse(HeldBowFileSchema,await product.json(bowSlot.file)),bow=heldBowBase({bow:definition.bow,base:definition.base});
  const bladeItem=product.shardfile.items.rows.find(row=>row.id===bladeSlot.item),spearItem=product.shardfile.items.rows.find(row=>row.id===spearSlot.item);
  if(bladeItem?.kind!=='weapon'||spearItem?.kind!=='weapon')throw new Error('Missing actual weapon catalogue profiles');
  const melee=v.parse(MeleeWeaponProfileSchema,bladeItem.profile),thrown=v.parse(ThrownWeaponProfileSchema,spearItem.profile);
  if(melee.mounted===undefined)throw new Error('Sabre requires its admitted mounted policy');
  const mountedRows=melee.mounted;
  const bladeKey=(key:BladeRows['moves']['rest']):BladeKey=>({t:key.t,pos:new Vector3(...key.pos),q:new Quaternion(...key.q)});
  const bladeMove=(move:BladeRows['moves']['heavy'])=>({...move,keys:[bladeKey(move.keys[0]),bladeKey(move.keys[1]),bladeKey(move.keys[2])] as const});
  const bladeMoves={rest:bladeKey(blade.moves.rest),charge:bladeKey(blade.moves.charge),sprint:bladeKey(blade.moves.sprint),
    combo:blade.moves.combo.map(bladeMove),heavy:bladeMove(blade.moves.heavy),
    passes:{left:bladeMove(blade.moves.passes.left),right:bladeMove(blade.moves.passes.right)}};
  const weather=v.parse(WeatherWorldSchema,arms.weather);
  const length=v.parse(v.object({length:v.pipe(finite,v.minValue(0))}),JSON.parse(bow.rows.bake.arrow)).length;
  const order=slots.equipment.order??slots.registration,available=new Set([bowSlot.id,bladeSlot.id,spearSlot.id]);
  if(order.some(id=>!available.has(id))||order.length!==3)throw new Error('The ordinary arsenal must retain its three real weapons');
  return (host, context) => {
    const { combat, tick, contacts, arrowTargets } = context, room = context.room === true;
    const taming = nativeTamingOf(host);
    if (taming === undefined || mountedPlayerOf(host) === undefined) throw new Error('Weapons require actual native riding');
    if (owners.has(host)) throw new Error('Native held equipment already has an owner');
    // A held arsenal has no launcher to own a slot: the wire's launcher is its aim, on whichever weapon is in hand.
    if (room) { const routes = actRoutes(host); routes.equip = arms.input.swap; routes.launcher = (index, reload) => index < order.length && !reload; }
    const seats = playerSeats<HeldSeat>(host, (player: PlayerSim, first: boolean) => {
    const mount = mountedPlayerOf(host, first ? undefined : player.id), frame = first ? combat : otherCombatFrame(combat, player.id), striker = room ? player.health : 'env';
    if (mount === undefined) throw new Error('Weapons require actual native riding');
    // On the wire a start is the command that made it, and what it lands says so: a page lets go of a swing no one owns.
    let seq=0,pressing=false,chained:number|null=null,swing=0;
    const started=():void=>{if(swing!==0)player.swing.seq=swing;};
    let slot=slots.selection.initial??bowSlot.id,queued=false,aim=0,pitch=0,ammo=thrown.carried,bolts=bow.base.quiver,weaponsEnabled=true;
    let shots=0,letdowns=0,fullDraws=0,aimOn=false,aimBlend=0,passes=0,passDamage=melee.damage,thrusts=0,throws=0,recovered=0;
    const scope=first?host.scope:host.scope.child(`held:${player.id}`),moves:string[]=[],draw=new BowDraw(bow.base.draw),decision=new HeldDecision(blade.program,scope),pass=new MountedPassLaw(decision);
    const polearm=new PolearmDecision<AnimalSim>(spear.program,scope),wind=new Wind({value:1});
    const foot=bowMount(bow.base,0,null);if(foot===null)throw new Error('Missing on-foot bow state');let saddle:BowMountState=foot;
    const body=(id:string):AnimalSim=>{const actor=host.entities.get(id);if(actor===undefined)throw new Error(`Missing native weapon target ${id}`);return actor;};
    const knownContacts=new WeakMap<TargetAnimal,string>(),retiredContacts=new Map<number,string>();
    const key=(actor:TargetAnimal):string=>{for(const [id,row] of host.entities)if(row===actor){knownContacts.set(actor,id);return id;}throw new Error('Foreign native weapon target');};
    const retired=():ReadonlySet<string>=>{
      const population=nativePopulationOf(host),owner=population===undefined?undefined:host.adapters.get(population.id);
      if(owner===undefined)throw new Error('Missing native weapon retirement authority');
      return new Set(v.parse(v.object({retired:v.array(v.string())}),owner.snapshot()).retired);
    };
    // A retired body cannot be raycast again, but its occupied hit slot still
    // counts against this swing's cap. Restore only the identity witnessed by
    // the real population, never a replacement body or a new combat target.
    const bladeContactKey=(actor:TargetAnimal|null,index:number):string=>{
      if(actor===null){const id=retiredContacts.get(index);
        if(id===undefined||host.entities.has(id)||!retired().has(id))throw new Error('Missing retired blade contact');return id;}
      const id=knownContacts.get(actor);
      if(id!==undefined&&host.entities.get(id)!==actor){
        if(actor.alive||host.entities.has(id)||!retired().has(id))throw new Error('Foreign retired blade contact');return id;
      }
      return key(actor);
    };
    const arrowKey=(actor:TargetAnimal):string=>{
      if(arrowTargets===undefined)return key(actor);
      const id=arrowTargets.key(host,actor);if(id===null)return key(actor);
      if(host.entities.has(id)||arrowTargets.resolve(host,id)!==actor)throw new Error('Encounter arrow target identity changed');
      return id;
    };
    const arrowBody=(id:string):TargetAnimal=>{
      const actor=host.entities.get(id);if(actor!==undefined)return actor;
      const target=arrowTargets?.resolve(host,id);
      if(target===undefined||target===null||arrowTargets?.key(host,target)!==id)throw new Error('Missing encounter arrow target');
      return target;
    };
    const bodies=():AnimalSim[]=>[...host.entities.values()].filter(actor=>actor.alive&&actor!==mount.horse);
    const targets=():AnimalSim[]=>filterCombatAimTargets(bodies(),aimRows.exclude);
    const basePose=new SweptBasePose(),sweep=new BladeSweep(melee.sweep);basePose.rest(bladeMoves.rest);let bladeContacts=0;
    const grip=new Vector3(),tip=new Vector3(),basePos=new Vector3(),baseQ=new Quaternion(),left=new Vector3(),strikeDirection=new Vector3(),push=new Vector3(),up=new Vector3(0,1,0);
    const eye=new Vector3(),forward=new Vector3(),scratch=new Vector3(),velocity=new Vector3(),rotation=new Quaternion(),euler=new Euler(0,0,0,'YXZ');
    const random=():number=>host.rng.stream('gameplay').next();
    const ray=(from:Vector3,dir:Vector3,distance:number)=>{
      const original=nativeRangedHit(bodies(),from,dir,distance);
      const hit=contacts===undefined?original:contacts(host,from,dir,distance,original);return hit===null||hit.body===null?null:{animal:hit.body,point:hit.point,distance:hit.distance,headshot:hit.head};
    };
    const spearContacts=new PolearmContact<AnimalSim>({raycast:ray,same:(animal,target)=>animal===target,
      contact:(animal,amount,point,dir,from,moveId)=>host.combat.hit({source:striker,sourceTags:['actor.player',spearItem.id,'dmg.melee'],
        target:body(key(animal)).combatActor(),amount,point,dir,from,weaponId:spearItem.id,moveId,...(swing===0?{}:{attackSeq:swing})}),struck:()=>undefined},polearm);
    const floor=(x:number,y:number,z:number):number=>floorBelow(host.physics,x,z,y+.3,60)??host.groundHeightAt(x,z);
    /** A shot's blow in a room: this player's, so it earns and it answers its press. A shard's own target takes it as ever. */
    const landed=(animal:TargetAnimal,amount:number,point:Vector3,dir:Vector3,weaponId:string,attackSeq:number):boolean=>{
      for(const actor of host.entities.values())if(actor===animal)return host.combat.hit({source:striker,sourceTags:['actor.player',`weapon.${weaponId}`,'dmg.ranged','cover.checked'],
        target:actor.combatActor(),amount,point,dir,weaponId,attackSeq})?.killed??false;
      return animal.applyDamage(amount,point,dir);
    };
    const arrows=new ProjectileLaw(bow.rows.arrow.maxFlying>0?{...bow.rows.arrow,length,
      substeps:bow.base.projectile?.substeps??4,lifetime:bow.base.projectile?.lifetime??12}:(()=>{throw new Error('Missing bow flight slots');})(),{
      feet:player.position,extent:host.level.ground.size/2,floorAt:floor,world:(from,to,radius)=>worldHit(host.physics,from,to,radius),
      targets:(from,dir,distance)=>{const hit=ray(from,dir,distance);return arrowTargets===undefined?hit:arrowTargets.ray(host,from,dir,distance,hit);},
      wind:()=>wind,surface:wall=>wall.material==='flesh'?'flesh':wall.material==='wood'||wall.material==='planks'?'wood':'ground',
      random,canRecover:()=>bolts<bow.base.quiver,recover:survived=>{if(survived)bolts=Math.min(bow.base.quiver,bolts+1);},
      flight:()=>({seq:0}),stuck:()=>null,moved:()=>undefined,ended:()=>undefined,settled:()=>undefined,changed:()=>undefined,removed:()=>undefined,impact:()=>undefined,
      playerHit:()=>{throw new Error('Player bow cannot become an enemy projectile');},targetHit:()=>undefined,hit:()=>undefined,
      ...(room?{strike:(flight:{readonly seq:number},animal:TargetAnimal,amount:number,point:Vector3,dir:Vector3)=>landed(animal,amount,point,dir,bowSlot.id,flight.seq)}:{}),
    });
    const javelins:JavelinSlot[]=Array.from({length:thrown.pool},()=>({state:0,pos:new Vector3(),vel:new Vector3(),q:new Quaternion(),age:0}));
    const flight=new JavelinFlight<NonNullable<ReturnType<typeof ray>>>(javelins,thrown,{worldHit:(from,to,radius)=>worldHit(host.physics,from,to,radius),raycast:ray,
      strike:(hit,damage,dir)=>{const killed=room?landed(hit.animal,damage,hit.point,dir,spearItem.id,swing):hit.animal.applyDamage(damage,hit.point,dir);if(!killed)hit.animal.stagger(scratch.set(dir.x,0,dir.z).normalize(),thrown.stagger);},
      impact:()=>undefined,water:(x,z)=>host.waterSurfaceAt(x,z),floor,random,damageScale:()=>1,
      surface:material=>material==='flesh'?'flesh':material==='wood'||material==='planks'?'wood':'ground'});
    const extra=[bladeMoves.passes.left,bladeMoves.passes.right];
    const live=():void=>{if(host.scope.disposed||host.scope.disposing)throw new Error('Native held equipment owner retired');};
    const seat:Pick<HeldSeat,'look'|'setEnabled'|'refill'|'arrows'>={arrows:()=>bolts,look:{get yaw(){return player.yaw;},set yaw(value){live();player.yaw=value;},
      get pitch(){return pitch;},set pitch(value){live();pitch=value;}},setEnabled:on=>{live();weaponsEnabled=on;},refill:()=>{
      live();for(const refill of slots.refills){
        if(refill.slot===bowSlot.id&&refill.kind==='add-magazine')bolts=Math.min(bow.base.quiver,bolts+bow.base.quiver);
        else if(refill.slot===spearSlot.id&&refill.kind==='fill-capacity')ammo=thrown.carried;
        else throw new Error('Invalid admitted native held refill owner');
      }
    }};
    const pose=():void=>{const p=player.position;eye.set(p.x,p.y+1.68,p.z);rotation.setFromEuler(euler.set(pitch,player.yaw,0));forward.set(0,0,-1).applyQuaternion(rotation);};
    const clock=new SweptMeleeCore(bladeMoves,melee,{queue:()=>{queued=true;chained=seq;},consume:()=>{const before=queued;queued=false;return before;}},{
      start:(move,lunge)=>{swing=pressing?seq:chained??seq;chained=null;started();moves.push(move.name);if(moves.length>64)moves.shift();sweep.reset();retiredContacts.clear();basePose.startSwing();
        const heavy=move===bladeMoves.heavy;
        const target=lunge?pickLunge(targets(),player.position,player.yaw,heavy?melee.lunge.heavyRange:melee.lunge.range,melee.lunge.cone):null;
        if(target!==null){const feet=player.position,dash=sweptLunge(melee.lunge,heavy,target.position.x-feet.x,target.position.z-feet.z,targetRadius(target));
          if(dash!==null)player.dashTo(target.position.x,target.position.z,dash.stopAt,dash.time);}
      },charge:()=>undefined,
    });
    const step=(dt:number):void=>{
      const commands=first?tick.commands():tick.commandsOf(player.id),own=commands.find(command=>command.kind==='player');
      seq=room?own?.seq??0:0;
      const enabled=weaponsEnabled&&player.health.alive&&(!first||taming.phase!=='breaking');
      // A net command names no held action of its own: its attack is the press, its equip the slot, its launcher the aim.
      const pressed=commands.some(command=>command.kind==='script'&&command.actorId===arms.input.attack&&command.value===1)
        ||(room&&(own?.attack!==undefined||(own?.swing===true&&own.heavy===undefined)));
      for(const command of commands)if(command.kind==='script'&&command.actorId===arms.input.swap){
        if(!room&&command.value!==1)throw new Error('Invalid weapon swap input');if(!weaponsEnabled)continue;const index=order.indexOf(slot),next=room?order[command.value??-1]:order[(index+1)%order.length];
        if(room&&next===undefined)continue;
        if(next===undefined)throw new Error('Missing next held slot');slot=next;clock.stop();queued=false;
      }
      aim=0;
      for(const command of commands)if(command.kind==='script'&&command.value!==undefined){
        if(command.actorId===arms.input.aim){
          if(command.value!==0&&command.value!==1)throw new Error('Invalid held AIM input');aim=command.value;
        }else if(command.actorId===arms.input.pitch){
          if(command.value< -Math.PI/2||command.value>Math.PI/2)throw new Error('Invalid held look pitch');pitch=command.value;
        }
      }else if(room&&command.kind==='launcher'&&(command.ads??0)>0)aim=1;
      if(room&&own?.pitch!==undefined)pitch=Math.max(-Math.PI/2,Math.min(Math.PI/2,own.pitch));
      // riding/client publishes weapon yaw opposite the horse body heading.
      const mounted=mount.horse===null?null:{speed:mount.body.speed,yaw:mount.body.heading-Math.PI};
      const sampled=bowMount(bow.base,player.yaw,mounted);if(sampled!==null)saddle=sampled;
      const blocked=bowBlocked({enabled:enabled&&slot===bowSlot.id,cancel:false,bolts,sprinting:mount.rider.sprinting,mounted:mount.mounted,swimming:player.swim.on});
      const event=draw.step(dt,slot===bowSlot.id&&own?.heavy!==undefined,blocked.blocked,saddle.draw);
      if(event==='full')fullDraws++;if(event==='letdown'||event==='tired')letdowns++;
      if(event==='loose'){
        const speed=mount.mounted?0:frame.speedFactor;if(speed===null)throw new Error('Native bow requires its actual motion sample');
        pose();const spread=bowLooseSpreadDegrees(bow.base,aimBlend,speed,0,saddle.spread);
        shotSpread(forward,MathUtils.degToRad(spread),random,bow.base.loose??{radius:'sqrt',axisScale:1},scratch);
        eye.addScaledVector(forward,bowMuzzle(bow.base));velocity.copy(forward).multiplyScalar(bowLaunchSpeed(bow.base,1));
        velocity.x+=saddle.carrier.x;velocity.y+=saddle.carrier.y;velocity.z+=saddle.carrier.z;
        arrows.launch(eye,velocity,{damageScale:bow.base.damageScale}).seq=swing=seq;started();bolts--;shots++;
      }
      aimOn=bowAimOn({asked:aim>0,enabled:enabled&&slot===bowSlot.id,running:blocked.running,swimming:player.swim.on});
      aimBlend+=((aimOn?1:0)-aimBlend)*Math.min(1,dt*bow.base.aimIn);if(Math.abs(aimBlend-(aimOn?1:0))<.002)aimBlend=aimOn?1:0;
      const weatherOwner=host.adapters.get(weather.step);if(weatherOwner===undefined)throw new Error('Missing actual native wind owner');
      wind.restore(v.parse(OWNER_WIND,weatherOwner.snapshot()).wind);arrows.update(dt);
      if(slot===bladeSlot.id&&enabled){
        if(pressed){pressing=true;if(mounted===null)clock.tryFire();else pass.attack();pressing=false;}
        const strike=pass.decide(dt,{player,mount:mounted,charging:clock.chargingHeavy,baseDamage:melee.damage,rows:mountedRows,targets:targets()});
        if(strike!==null){passDamage=strike.damage;if(clock.strike(strike.side<0?bladeMoves.passes.left:bladeMoves.passes.right,false))passes++;}
        if(clock.move===null)passDamage=melee.damage;
        const {move,active}=clock.step(dt,host.clock.now,melee.swingScale,own?.heavy!==undefined);
        basePose.blend(dt,SWORD_WOOD.chargeBlend,clock.chargingHeavy,mount.rider.sprinting,move!==null);
        basePose.pose(bladeMoves,move,clock.swingTime,clock.charge,host.clock.now,basePos,baseQ);
        if(move!==null){
          sweptBladeDirs(basePose.basePos,basePose.baseQ,blade.rig.tipX,blade.rig.tipY,grip,tip);pose();
          if(!active||!sweep.have||!bladeInReach(eye,melee.reach,targets(),targetRadius))sweep.hold(grip,tip);
          else sweep.sweep(grip,tip,eye,rotation,move.reach??melee.reach,{raycast:ray,
            blocked:(origin,point)=>bladeBlocked(host.physics,origin,point,player.motor.collider),
            strike:hit=>{left.copy(forward).applyAxisAngle(up,Math.PI/2);
              strikeDirection.copy(forward).multiplyScalar(.7).addScaledVector(left,.7*move.sweep).normalize();
              if(Math.abs(move.sweep)<.6)strikeDirection.y-=.35*(1-Math.abs(move.sweep));strikeDirection.normalize();
              const result=host.combat.hit({source:striker,sourceTags:['actor.player',bladeItem.id,'dmg.melee','cover.checked'],
                target:body(key(hit.animal)).combatActor(),amount:Math.round(sweptMoveDamage(passDamage,move,move===bladeMoves.heavy,1)),
                point:hit.point,dir:strikeDirection,from:eye,weaponId:bladeItem.id,moveId:`move.${move.name}`,...(swing===0?{}:{attackSeq:swing})});
              if(result===null)return;bladeContacts++;
              push.set(forward.x,0,forward.z).normalize().multiplyScalar(.8).addScaledVector(left,.5*move.sweep);
              if(!result.killed)hit.animal.stagger?.(push,move.stagger);
              if(move===bladeMoves.passes.left||move===bladeMoves.passes.right)pass.hit();
            }});
        }
      }else clock.stop();
      if(pressed&&slot===spearSlot.id&&enabled){polearm.attackPending=true;swing=seq;started();}
      polearm.stow(slot===spearSlot.id,enabled);
      const out=polearm.decide(dt,host.clock.now,{player:player.position,heading:mounted?.yaw??player.yaw,held:slot===spearSlot.id,
        enabled,ads:slot===spearSlot.id&&aim>0,ammo,capacity:thrown.carried,mount:mounted,targets:targets(),
        radius:targetRadius,javelins,random,policy:spear.profile,projectile:thrown});
      if(out!==null){if(out.launch&&ammo>0&&flight.free()){ammo--;pose();if(flight.launch(eye,rotation,forward,mounted))throws++;}
        if(out.strike){thrusts++;pose();spearContacts.thrust(eye,rotation,forward,spear.profile);}
        if(out.target!==undefined){pose();spearContacts.lance(eye,out.target,out.damage,host.clock.now,player.position);}
        const pickup=javelins[out.pickup];if(pickup!==undefined){pickup.state=0;if(out.recover){ammo++;recovered++;}}}
      flight.fly(dt);
    };
    return {...seat,step,
      snapshot:()=>JSON.stringify({version:1,...(weaponsEnabled?{}:{enabled:false}),slot,queued,aim,pitch,ammo,draw:draw.save(),bolts,shots,letdowns,fullDraws,aimOn,aimBlend,moves:[...moves],passes,passDamage,
        blade:{pose:basePose.snapshot(),grip:sweep.grip.toArray(),tip:sweep.tip.toArray(),have:sweep.have,
          struck:sweep.struck.slice(0,sweep.struckN).map(bladeContactKey),contacts:bladeContacts},
        swing:clock.snapshot(extra),pass:pass.snapshot(),cadence:decision.snapshot(),thrusts,throws,recovered,polearm:polearm.snapshot(actor=>actor.entityId),
        flying:arrows.pool.slots.map(row=>({active:row.active,age:row.age,glanced:row.glanced,pos:row.pos.toArray(),vel:row.vel.toArray(),origin:row.origin.toArray(),scale:row.scale})),
        stopped:arrows.stopped.snapshot(arrowKey),javelins:javelins.map(row=>({state:row.state,age:row.age,pos:row.pos.toArray(),vel:row.vel.toArray(),q:row.q.toArray()}))}),
      restore:input=>{const saved=v.parse(Saved,typeof input==='string'?JSON.parse(input):input);if(!available.has(saved.slot)||saved.flying.length!==arrows.pool.slots.length||saved.javelins.length!==javelins.length
          ||saved.ammo>thrown.carried||saved.bolts>bow.base.quiver||saved.blade.struck.length>melee.sweep.maxHits
          ||new Set(saved.blade.struck).size!==saved.blade.struck.length)throw new Error('Invalid native weapon continuation');
        const missing=new Map<number,string>();
        const struck=saved.blade.struck.map((id,index)=>{const actor=host.entities.get(id);if(actor!==undefined){knownContacts.set(actor,id);return actor;}
          if(!retired().has(id))throw new Error(`Missing native weapon target ${id}`);missing.set(index,id);return null;});
        basePose.restore(saved.blade.pose);sweep.reset();retiredContacts.clear();for(const [index,id]of missing)retiredContacts.set(index,id);
        sweep.grip.fromArray(saved.blade.grip);sweep.tip.fromArray(saved.blade.tip);sweep.have=saved.blade.have;
        struck.forEach((actor,index)=>{sweep.struck[index]=actor;});sweep.struckN=struck.length;bladeContacts=saved.blade.contacts;
        clock.restore(v.parse(SwingSaved,saved.swing),extra);pass.restore(saved.pass);decision.restore(saved.cadence);
        polearm.restore(saved.polearm,body,id=>!host.entities.has(id)&&retired().has(id));draw.load(saved.draw);
        arrows.stopped.restore(saved.stopped,arrowBody);
        saved.flying.forEach((row,index)=>{const target=arrows.pool.slots[index];if(target===undefined)throw new Error('Missing native arrow slot');
          target.active=row.active;target.age=row.age;target.glanced=row.glanced;target.pos.fromArray(row.pos);target.vel.fromArray(row.vel);target.origin.fromArray(row.origin);target.scale=row.scale;});
        saved.javelins.forEach((row,index)=>{const target=javelins[index];if(target===undefined)throw new Error('Missing native javelin slot');
          target.state=row.state;target.age=row.age;target.pos.fromArray(row.pos);target.vel.fromArray(row.vel);target.q.fromArray(row.q);});
        slot=saved.slot;queued=saved.queued;aim=saved.aim;pitch=saved.pitch;ammo=saved.ammo;bolts=saved.bolts;shots=saved.shots;letdowns=saved.letdowns;
        fullDraws=saved.fullDraws;aimOn=saved.aimOn;aimBlend=saved.aimBlend;moves.splice(0,moves.length,...saved.moves);passes=saved.passes;
        passDamage=saved.passDamage;thrusts=saved.thrusts;throws=saved.throws;recovered=saved.recovered;weaponsEnabled=saved.enabled;
      }};
    });
    owners.set(host, seats); host.scope.onDispose(() => { owners.delete(host); });
    if (room) {
      // A page's own count would drift from these: its misses aren't the server's, and it never hears a refill. Saying it, and refilling as a page's respawn does, keeps one count.
      publishOwned(host, 'held.arrows', (id, out) => { const player = host.players.get(id); if (player !== undefined) out.set(OWNED_ROW.arrows, seats.of(player).arrows() + 1); });
      host.events.on('player.respawned', ({ player: id }) => { const player = id === undefined ? undefined : host.players.get(id); if (player !== undefined) seats.of(player).refill(); }, host.scope);
    }
    host.onStep(arms.step, seats.step, seats.adapter, 'afterBodies');
  };
}
