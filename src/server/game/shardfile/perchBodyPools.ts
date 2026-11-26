import {parse,strictObject,literal,array,pipe,number,finite,integer,minValue,maxValue,maxLength,tuple} from 'valibot';
import {CreaturePerchBodiesSchema,type CreaturePerchBody} from '@wildshard/format/creaturePerch';
import type {ShardRows} from '@wildshard/format/rows';
import {Vector3,Euler,Quaternion} from 'three';
import type {AnimalSim} from '@wildshard/engine/entities/AnimalSim';
import type {SimHost} from '@wildshard/engine/sim';
import type {Rng} from '@wildshard/format/seededRng';
import {Bodies,BODY_SLOT_CONTACT_PLAYERS,RowBodySlots} from '@wildshard/engine/physics/bodies';
import {publishScriptBody} from '@wildshard/engine/sim/shardRows';
import {volleyRow} from '../../../shared/game/shardfile/wirePrompts';

export const PERCH_POOLS_STEP='data.perch.pools';
/** One native owner per admitted catalogue, shared by its spawns. The caller
 * lends its existing random stream and action cadence; this owns no brain. */
export function installPerchBodyPools(host:SimHost,input:readonly CreaturePerchBody[],rows:Pick<ShardRows,'strikes'>):{
  throw:(id:string,from:Vector3,to:Vector3,source:AnimalSim,rng:Rng)=>void;
}{
  const catalogue=parse(CreaturePerchBodiesSchema,input),sources=[...host.entities.keys()];
  const strikes=new Map(rows.strikes.map(row=>[row.id,row]));
  for(const row of catalogue)if(!strikes.has(row.projectile.strike))throw new Error('Missing declared perch projectile strike');
  if(catalogue.length===0)return {throw:()=>{throw new Error('Missing declared perch pool');}};
  if(host.hasStep(PERCH_POOLS_STEP)||host.adapters.has(PERCH_POOLS_STEP))throw new Error('Perch pools already installed');
  const contract=JSON.stringify({catalogue,strikes:catalogue.map(row=>strikes.get(row.projectile.strike)),sources});
  // Native catalogue admission bounds all pools together to128 slots. Its
  // authored slots own retirement; a page tier must not cull server authority.
  const capacity=catalogue.reduce((total,row)=>total+row.projectile.pool.count,0);
  let service=new Bodies(host.physics,host.playerFocus,capacity);
  const owner=host.scope.child('perch.pools.bodies');
  const pools=catalogue.map((row,index)=>new RowBodySlots<AnimalSim>(row.projectile.pool,service,{kind:`perch.${String(index)}`},host.physics,host));
  const byId=new Map(catalogue.map((row,index)=>[row.id,index]));
  const poses:Vector3[]=[],direction=new Vector3(),point=new Vector3();
  for(const [index,pool] of pools.entries())for(let slot=0;slot<pool.row.count;slot++){
    const euler=new Euler(),rotation=new Quaternion(),position=new Vector3(),view={position,euler,enabled:false};
    // Read the actual native body, including a just-consumed contact slot.
    // Sampling publishes; installation and restore never draw or spawn.
    publishScriptBody(host,volleyRow(`perch.${String(index)}`,slot),()=>{
      const body=pool.bodyAt(slot);view.enabled=body!==null;
      if(body!==null){position.copy(body.curr);rotation.copy(body.currRot);euler.setFromQuaternion(rotation);}
      return view;
    });
  }
  const bounded=(min:number,max:number)=>pipe(number(),finite(),integer(),minValue(min),maxValue(max));
  const nonnegative=pipe(number(),finite(),minValue(0));
  const savedPool=catalogue.map(row=>strictObject({id:literal(row.id),next:bounded(0,row.projectile.pool.count-1),
    slots:pipe(array(strictObject({k:bounded(0,row.projectile.pool.count-1),state:bounded(1,2),rest:nonnegative,age:nonnegative,
      thrower:bounded(-1,sources.length-1),handle:pipe(number(),finite()),wet:pipe(number(),finite(),minValue(0),maxValue(1))})),maxLength(row.projectile.pool.count))}));
  const Saved=strictObject({version:literal(1),contract:literal(contract),pools:tuple(savedPool)});
  host.onStep(PERCH_POOLS_STEP,dt=>{
    service.post(dt);poses.length=0;
    // QA 11-24 row 24: staging at 40 seats put 33 players in one cell, and the pool's 32-pose cap threw and took the
    // world down (server.crashed 2026-11-26 01:20 UTC). Past the cap, the first 32 live players are this step's targets.
    for(const player of host.players.values()){
      if(poses.length>=BODY_SLOT_CONTACT_PLAYERS)break;
      if(player.health.alive&&!host.parked.has(player.id))poses.push(player.position);
    }
    for(const [index,pool] of pools.entries()){
      pool.updateTargets(dt,1,poses);
      const row=catalogue[index],strike=row===undefined?undefined:strikes.get(row.projectile.strike);
      if(strike===undefined)throw new Error('Missing admitted perch projectile');
      for(const event of pool.takeEvents()){
        if(event.kind!=='contact'||event.source===null)continue;
        for(const player of host.players.values()){
          if(player.position!==event.target||!player.health.alive||host.parked.has(player.id))continue;
          point.copy(event.at);direction.subVectors(player.position,event.at).normalize();
          host.combat.hit({source:event.source.combatActor(),sourceTags:strike.tags,target:player.health,amount:strike.damage,
            point,dir:direction,moveId:strike.id,cause:{kind:event.source.kind,label:event.source.label}});
          break;
        }
      }
    }
    service.pre(dt);
  },{snapshot:()=>({version:1,contract,pools:pools.map((pool,index)=>({id:catalogue[index]?.id??'',...pool.snapshot(sources)}))}),
    restore:value=>{
      const saved=parse(Saved,value);
      // Validate every slot identity before mutating any owner.
      for(const row of saved.pools)if(new Set(row.slots.map(slot=>slot.k)).size!==row.slots.length)throw new Error('Duplicate saved perch slot');
      const actors=sources.map(id=>host.entities.get(id)??null);
      for(const [index,pool] of pools.entries()){
        const row=saved.pools[index];if(row===undefined)throw new Error('Missing saved perch pool');pool.restore(row,actors);
      }
    },physicsRestored:()=>{service=new Bodies(host.physics,host.playerFocus,capacity);for(const pool of pools)pool.bind(service);}});
  host.scope.onDispose(()=>{for(const pool of pools)pool.dispose();service.dispose();});
  return {throw:(id,from,to,source,rng)=>{
    const index=byId.get(id),row=index===undefined?undefined:catalogue[index],pool=index===undefined?undefined:pools[index];
    if(row===undefined||pool===undefined||host.entities.get(source.entityId)!==source||host.scope.disposed)throw new Error('Missing declared perch launch authority');
    owner.run(()=>{pool.throw(row.projectile.launch,from,to,source,rng);});
  }};
}
