/** The night patrol (timed encounters) on a host: the same night cycle, directed riders, numeric contact joints and covered
 *  projectile hits as the page. Inputs cannot request a spawn, night, kill or gate. Each line deals with the player nearest it. */
import * as v from 'valibot';
import { Vector3, Ray } from 'three';
import { SpeciesActorsFileSchema } from '@wildshard/format/speciesBookRows';
import { parseExternalElite } from '@wildshard/format/eliteFeature';
import { TimedEncountersSchema } from '@wildshard/format/encounterRows';
import { nativeBodySchema } from '@wildshard/format/nativePhysics';
import { parsePackedCreatureLooks } from '@wildshard/format/speciesLooks';
import { CHUNK_HALF } from '@wildshard/format/contentBounds';
import type { DamageRequest } from '@wildshard/engine/combat/pipeline';
import type { HuntBody } from '@wildshard/engine/ai/hunt';
import type { SimHost } from '@wildshard/engine/sim';
import type { AnimalRigContext } from '@wildshard/engine/entities/animalRig';
import { EliteReadiness } from '@wildshard/engine/ai/eliteScript';
import { ProjectileLaw } from '@wildshard/engine/combat/projectileLaw';
import { StrikeRunner, type StrikeSpec } from '@wildshard/engine/ai/strikes';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import { canReach } from '@wildshard/engine/ai/reach';
import { floorBelow, worldHit } from '@wildshard/engine/physics/query';
import { pinBrain } from '@wildshard/engine/ai/pinning';
import { variantMods } from '@wildshard/engine/entities/species/registry';
import { sayFightView } from '@wildshard/engine/sim/shardRows';
import { nearestJointHit, type JointPorts } from '../../../shared/game/boss/jointTargets';
import { PatrolLaw } from '../../../shared/game/boss/patrolLaw';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { NativeCreaturePose, type NativeCreaturePoseRecipe } from '../../../shared/game/plugin/animation';
import { numericCreaturePoseFromBook } from '../../../shared/game/plugin/channelPrograms';
import { poseRidingEnvelopes } from '../../../shared/game/riding/presentation';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { PATROL_SHOT, PATROL_TEAR } from '../../../shared/game/shardfile/wirePrompts';
import type { nativeRangedHit } from '../plugin/nativeItems';
import type { EncounterIntake } from '../population/encounterIntake';
import { DirectedLaw } from '../population/directedLaw';
import { nativePopulationOf } from '../riding/nativePopulation';
import { nativeHerdCollection } from '../shardfile/groupRuntime';

const finite=v.pipe(v.number(),v.finite()),natural=v.pipe(finite,v.integer(),v.minValue(0));
const vector=v.tuple([finite,finite,finite]);
const ContactSource=v.strictObject({id:v.string(),kind:v.string(),label:v.string(),at:vector,head:vector,
  yaw:finite,scale:finite,bodyY:finite,bodyRadius:finite});
type PatrolContactSource=Pick<HuntBody,'entityId'|'kind'|'label'|'position'|'yaw'|'scale'|'headWorld'> & {
  readonly dims:{readonly bodyY:number;readonly bodyRadius:number};
};
const projection=v.strictObject({state:v.record(v.string(),finite),elapsed:v.pipe(finite,v.minValue(0))});
const Saved=v.strictObject({law:v.strictObject({cycle:projection,motion:projection,groups:v.pipe(v.array(projection),v.maxLength(64)),
  riders:v.pipe(v.array(v.strictObject({id:v.string(),law:projection,group:v.pipe(finite,v.integer(),v.minValue(-1)),slot:natural,steering:v.record(v.string(),finite)})),v.maxLength(64))}),
  readiness:v.strictObject({readyTime:finite,initialized:v.boolean(),eligible:v.boolean()}),
  poses:v.pipe(v.array(v.tuple([v.string(),v.string()])),v.maxLength(64)),shooter:v.nullable(ContactSource),shots:natural,hits:natural,
  flying:v.pipe(v.array(v.strictObject({active:v.boolean(),age:finite,glanced:v.boolean(),pos:vector,vel:vector,origin:vector,scale:finite})),v.maxLength(1024)),stopped:v.unknown()});

const Bones=v.pipe(v.array(v.object({name:v.string(),parent:v.nullable(v.string()),pos:v.tuple([finite,finite,finite])})),v.maxLength(32));

/** The patrol's assembly row, with its readiness rows read. */
export interface PatrolRow { readonly step: string; readonly rows: string; readonly actors: string; readonly looks: string; readonly herds: string; readonly external: readonly unknown[] }
export interface NativePatrol {
  readonly law:PatrolLaw<HuntBody,NativeCreaturePose>;
  readonly readiness:EliteReadiness;
  readonly shots:()=>number;
  readonly hits:()=>number;
  readonly target:(from:Vector3,direction:Vector3,distance:number,hit:ReturnType<typeof nativeRangedHit>)=>ReturnType<typeof nativeRangedHit>;
  readonly aimPoint:(body:HuntBody,out:Vector3)=>void;
}
const owners=new WeakMap<SimHost,NativePatrol>();
export function patrolOf(host:SimHost):NativePatrol|undefined{return owners.get(host);}
/** An arrow at `at` counts inside its rider's strike, measured from the rider or, by `origin`, the player, with nothing in the way. */
export function patrolContactLands(runner:StrikeRunner,strike:StrikeSpec,actor:PatrolContactSource,at:Vector3,origin:'actor'|'player',physics:Parameters<typeof canReach>[2]):boolean{
  return runner.contains(strike,{actor,target:at,...(origin==='player'?{origin:at}:{})})&&canReach(actor,at,physics);
}
/** A later entered arena may borrow the same native body scheduler. TimedEncounters updates its slot owner immediately before patrol. */
export interface PatrolLoans {
  readonly eliteDamage?:((host:SimHost,actor:HuntBody,request:DamageRequest)=>number)|undefined;
  readonly beforePatrol?:((host:SimHost,dt:number)=>void)|undefined;
  readonly afterPatrol?:((host:SimHost,dt:number)=>void)|undefined;
}

/** Conditional riders borrow the page's exact metadata and packed skeleton
 * dimensions. No body, random draw, model build or generated output is made. */
export async function readPatrolIntake(product:Pick<ShardProduct,'json'>,files:Pick<PatrolRow,'rows'|'actors'>):Promise<EncounterIntake> {
  const [actors,timed]=await Promise.all([
    product.json<unknown>(files.actors).then(value=>v.parse(SpeciesActorsFileSchema,value)),
    product.json<unknown>(files.rows).then(value=>v.parse(TimedEncountersSchema,value)),
  ]);
  const declaration=timed.patrol.actors;if(declaration===undefined)throw new Error('Patrol has no admitted rider declarations');
  const entry=actors.species.lookBook.rows.find(row=>row.metadata.kind===declaration.kind);
  if(entry===undefined)throw new Error('Patrol has no admitted species metadata');
  const species=entry.metadata;
  if(species.flight!==undefined)throw new Error('Patrol requires its original grounded body law');
  const recipes=[...species.variants,...species.spawnOnly??[]].map(variant=>{
    const selected=entry.variants[variant.id];
    if(selected===undefined)throw new Error('Patrol variant lacks its declared page body mapping');
    const body=actors.species.packedBodies.rows.find(row=>row.kind===entry.family&&row.variant===selected.body);
    const skeleton=body===undefined?undefined:actors.species.packedBodies.skeletons[body.skeleton];
    if(skeleton===undefined)throw new Error('Patrol variant lacks its original body dimensions');
    return v.parse(nativeBodySchema('axis'),{
      kind:species.kind,label:variant.label||species.label,variant:variant.id,rarity:variant.rarity,
      hp:variant.hp??species.tuning?.hp??(species.aggressive===true?100:60),
      aggressive:species.aggressive??false,dims:structuredClone(skeleton.dims),mods:variantMods(species,variant),
      ...(species.lockable===undefined?{}:{lockable:species.lockable}),
    });
  });
  for(const variant of [declaration.variant,declaration.leader])if(!recipes.some(row=>row.variant===variant))throw new Error('Patrol is missing an admitted variant recipe');
  return {species:[species],recipes};
}

/** The real patrol's contact joints and horse overlay, from the same admitted
 * skeleton and pose book the page uses. No geometry or body is manufactured. */
export async function readPatrolPoses(product:Pick<ShardProduct,'json'>,files:Pick<PatrolRow,'rows'|'actors'|'looks'>):Promise<{
  readonly kind:string;
  readonly rows:readonly {readonly kind:string;readonly variant:string;readonly pose:NativeCreaturePoseRecipe}[];
  readonly postPose:(context:AnimalRigContext,wind:{x:number;z:number;strength:number})=>void;
}> {
  const [actors,book,timed]=await Promise.all([
    product.json<unknown>(files.actors).then(input=>v.parse(SpeciesActorsFileSchema,input)),
    product.json<unknown>(files.looks).then(parsePackedCreatureLooks),
    product.json<unknown>(files.rows).then(input=>v.parse(TimedEncountersSchema,input)),
  ]);
  const kind=timed.patrol.actors?.kind;
  if(kind===undefined)throw new Error('Patrol contact pose requires its declared species');
  const metadata=actors.species.lookBook.rows.find(row=>row.metadata.kind===kind),look=book.rows.find(row=>row.kind===kind);
  if(metadata===undefined||look===undefined||look.postPose?.envelopes===undefined||look.rig==='custom'
    ||look.animate!==undefined||look.frame!==undefined||look.lift!==undefined)
    throw new Error('Patrol contact pose requires its actual quadruped and overlay');
  const post=look.postPose,envelopes=post.envelopes;
  if(envelopes===undefined)throw new Error('Patrol contact pose is missing its admitted envelopes');
  const alive=numericCreaturePoseFromBook(book,post.alive),dead=numericCreaturePoseFromBook(book,post.dead??post.alive);
  const poseRows=[...metadata.metadata.variants,...metadata.metadata.spawnOnly??[]].map(variant=>{
    const mapped=metadata.variants[variant.id];
    if(mapped===undefined)throw new Error('Patrol contact pose is missing its original body mapping');
    const packed=actors.species.packedBodies.rows.find(candidate=>candidate.kind===metadata.family&&candidate.variant===mapped.body);
    const skeleton=packed===undefined?undefined:actors.species.packedBodies.skeletons[packed.skeleton];
    if(skeleton===undefined)throw new Error('Patrol contact pose is missing its packed skeleton');
    const bones=v.parse(Bones,skeleton.bones);
    if(bones.length>32||new Set(bones.map(bone=>bone.name)).size!==bones.length)throw new Error('Patrol contact skeleton exceeds the original joint contract');
    const pose:NativeCreaturePoseRecipe={custom:false,deathSplay:false,
      ...(look.gait===undefined?{}:{gait:look.gait}),...(look.stance===undefined?{}:{pose:look.stance}),
      joints:bones.map((bone,index)=>{
        const parent=bone.parent===null?-1:bones.findIndex(candidate=>candidate.name===bone.parent);
        if(bone.parent!==null&&(parent<0||parent>=index))throw new Error('Patrol contact joints must retain parent order');
        const at=bones[parent];
        return {name:bone.name,parent,position:[bone.pos[0]-(at?.pos[0]??0),bone.pos[1]-(at?.pos[1]??0),bone.pos[2]-(at?.pos[2]??0)],
          order:'XYZ',scale:[1,1,1]};
      })};
    if(!pose.joints.some(joint=>joint.name===timed.ride.figure.bone))throw new Error('Patrol figure seat lacks its real joint');
    return {kind,variant:variant.id,pose};
  });
  return {kind,rows:poseRows,postPose:(context,wind)=>{poseRidingEnvelopes(context,envelopes,wind);(context.alive?alive:dead)(context);}};
}

/** Read the patrol's rows now. `begin` registers its place in the tick; what it returns finishes the install, over the world's bodies. */
export async function preparePatrol(product:Pick<ShardProduct,'json'>,files:PatrolRow):Promise<{readonly begin:(host:SimHost,loans:PatrolLoans)=>()=>void}>{
  const [poseRows,rows,actors]=await Promise.all([
    readPatrolPoses(product,files),
    product.json<unknown>(files.rows).then(value=>v.parse(TimedEncountersSchema,value)),
    product.json<unknown>(files.actors).then(value=>v.parse(SpeciesActorsFileSchema,value)),
  ]);
  const declared=rows.patrol.actors,metadata=actors.species.lookBook.rows.find(entry=>entry.metadata.kind===declared?.kind);
  if(declared===undefined||metadata?.directed===undefined||actors.species.lookBook.program===undefined)throw new Error('Patrol requires its admitted directed species owner');
  const directed=metadata.directed,programRows=actors.species.lookBook.program;
  const external=files.external.map(parseExternalElite).find(elite=>elite.mode==='script'&&elite.spawn.variant===declared.leader);
  if(external===undefined)throw new Error('Patrol requires its actual script-elite readiness owner');
  return {begin:(host,loans)=>{
    const [first]=host.players.values();if(first===undefined)throw new Error('Simulation host has no player');
    // The page advances timed encounters before native population movement.
    // Register that phase now, but restore its state only after body owners.
    let advance:(dt:number)=>void=()=>{throw new Error('Patrol installed incompletely');};
    host.onStep(`${files.step}.advance`,dt=>{loans.beforePatrol?.(host,dt);advance(dt);loans.afterPatrol?.(host,dt);});
    return ():void=>{
    const population=nativePopulationOf(host),clock=host.dayClock;
    if(population===undefined||clock===undefined||owners.has(host))throw new Error('Native patrol requires its original population and day clock');
    const {wind:poseWind}=nativeHerdCollection(host,files.herds);
    const brain=ReturnProgram.native(host,rows.program),decisions=ReturnProgram.native(host,programRows);
    population.bindSpecies(declared.kind,new DirectedLaw(directed,()=>decisions),(actor,request)=>loans.eliteDamage?.(host,actor,request)??1);
    let restoringViews=false;
    const readiness=new EliteReadiness();
    const poses=new Map<string,NativeCreaturePose>(),scopes=new Map<string,ReturnType<typeof host.scope.child>>();
    const present=(body:HuntBody,quiet:boolean):NativeCreaturePose=>{
      if(poses.has(body.entityId))throw new Error('Patrol cannot re-present a live contact owner');
      const recipe=poseRows.rows.find(row=>row.kind===body.kind&&row.variant===body.variant);
      if(recipe===undefined)throw new Error('Patrol rider lacks its actual contact pose');
      const scope=host.scope.child('patrol-actor');scopes.set(body.entityId,scope);
      if(quiet){if(!restoringViews)body.scale*=rows.ride.quietScale;pinBrain(body,scope);}
      const pose=new NativeCreaturePose(body,recipe.pose);poses.set(body.entityId,pose);
      body.sampleTerrain=()=>{pose.sampleTerrain();};body.headWorld=out=>{pose.headWorld(out);return out;};
      return pose;
    };
    // Each line deals with whoever is nearest it; a lone player is every answer.
    let anchor=():Vector3=>first.position;
    const line={get position(){return host.nearestPlayer(anchor()).position;}};
    const law=new PatrolLaw<HuntBody,NativeCreaturePose>(rows.patrol,rows.motion,brain,{player:line,random:host.rng.stream('ai'),aimRandom:()=>host.rng.stream('ai'),present});
    anchor=()=>law.riders[0]?.a.position??first.position;
    law.attachActors({factory:{model:(kind,variant)=>{population.validateSpawn(kind,variant);return kind;}},
      spawn:population.spawnElite,retire:body=>{population.retireElite(body);poses.delete(body.entityId);scopes.get(body.entityId)?.dispose();scopes.delete(body.entityId);}});
    const seat=new Vector3(),aim=new Vector3(),direction=new Vector3(),contact=new StrikeRunner(),strike=strikeFromData(rows.contact.strike);
    const hits:{from:PatrolContactSource|null;point:Vector3;dir:Vector3}[]=[];
    let shooter:PatrolContactSource|null=null,shots=0,totalHits=0;
    const sourceHead=new Vector3();
    const {geometry:_geometry,colour:_colour,renderOrder:_order,...arrowKind}=rows.ride.arrow;
    const arrows=new ProjectileLaw(arrowKind,{
      feet:first.position,extent:CHUNK_HALF+80,
      floorAt:(x,y,z)=>floorBelow(host.physics,x,z,y+.3,60)??host.groundHeightAt(x,z),
      world:(from,to,radius)=>worldHit(host.physics,from,to,radius),targets:()=>null,wind:()=>null,
      surface:wall=>wall.material==='flesh'?'flesh':wall.material==='wood'||wall.material==='planks'?'wood':'ground',
      random:()=>host.rng.stream('gameplay').next(),canRecover:()=>true,recover:()=>undefined,
      flight:()=>({}),stuck:()=>null,moved:()=>undefined,ended:()=>undefined,settled:()=>undefined,changed:()=>undefined,removed:()=>undefined,impact:()=>undefined,
      playerHit:(point,dir)=>{hits.push({from:shooter,point:point.clone(),dir:dir.clone()});},targetHit:()=>{throw new Error('Patrol arrow cannot select an animal target');},hit:()=>undefined,
    });
    if(arrowKind.hitsAnimals)throw new Error('Patrol requires its original player-only arrow contacts');
    host.onStep(`${files.step}-poses`,()=>{
      for(const [id,pose] of poses){
        const body=population.bodies.find(row=>row.entityId===id),dt=host.bodyDt(id);
        if(body===undefined)throw new Error('Patrol contact pose lost its original body');
        if(dt<=0)continue;
        const near=body.position.distanceToSquared(host.nearestPlayer(body.position).position)<140*140;
        pose.advance(dt,host.clock.now,near);if(near)poseRows.postPose(pose.context,poseWind);pose.publish();
      }
    },undefined,'afterBodies');
    advance=dt=>{
      hits.length=0;
      const effects=law.step(dt,{hold:0,night:Number(rows.phases.patrol.includes(clock.dayPhase))});
      readiness.observe(external,decisions,dt,law.killsTonight);
      for(let i=law.riders.length-1;i>=0;i--){
        const rider=law.riders[i];if(rider===undefined)throw new Error('Patrol roster changed during ordered effects');
        const effect=effects.get(rider),body=rider.a;
        if(effect?.['retire']===1){law.retire(i);continue;}
        if((rider.law.state[rows.ride.states.dying]??0)>0){rider.view.jointPoint(rows.ride.figure.bone,rows.ride.seat,seat);sayFightView(host,PATROL_TEAR,[seat.x,seat.y,seat.z]);}
        if(rider.law.state[rows.ride.states.dead]===1||body.hidden)continue;
        if(effect?.['shoot']===1){
          rider.view.jointPoint(rows.ride.figure.bone,rows.ride.seat,seat);seat.y+=rows.ride.lift.loose*body.scale;
          const out=law.aim(rows.ride.aim,seat);shooter=body;
          arrows.launch(seat,aim.set(out['dx']??0,out['dy']??0,out['dz']??0),{damageScale:1});shots++;
          sayFightView(host,PATROL_SHOT,[seat.x,seat.y,seat.z,aim.x,aim.y,aim.z]);
        }
      }
      // PatrolEncounterView leaves Projectiles.wind and onRecover unbound.
      // Keep null wind and real recovery/FIFO draws without an ammo grant.
      arrows.update(dt);
      for(const hit of hits){
        const actor=hit.from??law.riders[0]?.a;if(actor===undefined)continue;
        const struck=host.nearestPlayer(hit.point);
        if(!patrolContactLands(contact,strike,actor,struck.position,rows.contact.origin,host.physics))continue;
        host.combat.hit({source:'env',sourceTags:rows.contact.tags,target:struck.health,amount:rows.ride.damage,point:actor.position,dir:direction.set(0,0,0),cause:{kind:actor.kind,label:actor.label}});totalHits++;
      }
    };
    host.onStep(files.step,()=>undefined,{snapshot:()=>JSON.stringify({law:law.snapshot(),readiness:readiness.snapshot(),poses:[...poses].map(([id,pose])=>[id,pose.snapshot()]),shooter:shooter===null?null:{id:shooter.entityId,kind:shooter.kind,label:shooter.label,at:shooter.position.toArray(),
        head:shooter.headWorld(sourceHead).toArray(),yaw:shooter.yaw,scale:shooter.scale,bodyY:shooter.dims.bodyY,bodyRadius:shooter.dims.bodyRadius},shots,hits:totalHits,
      flying:arrows.pool.slots.map(slot=>({active:slot.active,age:slot.age,glanced:slot.glanced,pos:slot.pos.toArray(),vel:slot.vel.toArray(),origin:slot.origin.toArray(),scale:slot.scale})),
      stopped:arrows.stopped.snapshot(body=>{const id=population.bodies.find(row=>row===body)?.entityId;if(id===undefined)throw new Error('Patrol projectile lost its admitted body');return id;})}),restore:value=>{
      if(typeof value!=='string')throw new Error('Patrol continuation must retain its original string envelope');
      const parsed:unknown=JSON.parse(value),saved=v.parse(Saved,parsed);
      if(saved.flying.length!==arrows.pool.slots.length||saved.poses.length!==saved.law.riders.length||new Set(saved.poses.map(([id])=>id)).size!==saved.poses.length)throw new Error('Patrol continuation has a different contact roster');
      const body=(id:string):HuntBody=>{const actor=population.bodies.find(row=>row.entityId===id);if(actor===undefined)throw new Error('Patrol continuation lost its original body');return actor;};
      for(const scope of scopes.values())scope.dispose();scopes.clear();poses.clear();
      readiness.restore(saved.readiness);
      restoringViews=true;try{law.restore(saved.law,body);}finally{restoringViews=false;}
      for(const [id,wire]of saved.poses){const pose=poses.get(id);if(pose===undefined)throw new Error('Patrol continuation lost its original pose');pose.restore(wire);}
      saved.flying.forEach((row,index)=>{const slot=arrows.pool.slots[index];if(slot===undefined)throw new Error('Missing patrol flight slot');Object.assign(slot,{active:row.active,age:row.age,glanced:row.glanced,scale:row.scale,hitScale:undefined});slot.pos.fromArray(row.pos);slot.vel.fromArray(row.vel);slot.origin.fromArray(row.origin);});
      arrows.stopped.restore(saved.stopped,body);
      const source=saved.shooter;
      // A retired arrow source is a contact query, never a replacement actor.
      // The page retains that same body's final pose after roster retirement.
      shooter=source===null?null:population.bodies.find(actor=>actor.entityId===source.id)??{
        entityId:source.id,kind:source.kind,label:source.label,position:new Vector3().fromArray(source.at),yaw:source.yaw,scale:source.scale,
        dims:{bodyY:source.bodyY,bodyRadius:source.bodyRadius},headWorld:out=>out.fromArray(source.head),
      };
      shots=saved.shots;totalHits=saved.hits;
    }});
    const ray=new Ray(),crossing=new Vector3();
    const joints:JointPorts<(typeof law.riders)[number],HuntBody>={
      actor:rider=>rider.a,dead:rider=>rider.law.state[rows.ride.states.dead]===1,
      joint:(rider,at,out)=>rider.view.jointPoint(rows.ride.figure.bone,at,out),
    };
    const target:NativePatrol['target']=(from,heading,distance,original)=>{
      ray.set(from,heading);
      const found=nearestJointHit(ray,original===null?distance:Math.min(distance,original.distance),law.riders,joints,rows.ride.targets,crossing);
      return found===null?original:{body:found.actor,point:crossing.clone(),distance:found.distance,head:found.head};
    };
    const aimPoint:NativePatrol['aimPoint']=(body,out)=>{
      const rider=law.riders.find(row=>row.a===body),point=rows.ride.targets.find(row=>!row.head);
      if(rider===undefined||point===undefined)throw new Error('Missing original patrol target joint');
      rider.view.jointPoint(rows.ride.figure.bone,point.at,out);
    };
    owners.set(host,{law,readiness,shots:()=>shots,hits:()=>totalHits,target,aimPoint});host.scope.onDispose(()=>{owners.delete(host);poses.clear();scopes.clear();});
    };
  }};
}
