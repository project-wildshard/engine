import { nalatiNativeAssembly } from './nalati-native-assembly';
import * as v from 'valibot';
import {Vector3} from 'three';
import type {HuntBody} from '../../src/server/engine/ai/hunt';
import type {SimHost} from '../../src/server/engine/sim';
import type {PrepareHeadlessRuntime} from '../../src/server/host/headlessRuntime';
import {eliteScriptFrame,eliteDamageScale} from '../../src/shared/engine/ai/eliteScript';
import {pinBrain} from '../../src/shared/engine/ai/pinning';
import {parseExternalElite} from '@wildshard/format/eliteFeature';
import {ReturnProgram} from '../../src/shared/game/population/returnProgram';
import {SpawnScript,readSpawnScript} from '../../src/server/game/population/spawnScript';
import {nativeEliteCore} from '../../src/server/game/shardfile/nativeAssemblyHosts';
import {NALATI_ELITE_CONDITIONS} from '../../src/shards/nalati-grasslands/generators/nativeServer';
import {withNalatiWeapons} from './nalati-weapons-native';
import {prepareNalatiPatrol,nalatiPatrolOf} from './nalati-patrol-native';
import {StrikeRunner} from '../../src/shared/engine/ai/strikes';
import {strikeFromData} from '../../src/shared/engine/ai/strikeRows';
import {canReach} from '../../src/shared/engine/ai/reach';
import {nativeGroupCollection} from '../../src/server/game/shardfile/groupRuntime';
import {parseEliteEntryPageRows} from '@wildshard/format/eliteEntryRows';
import {SpeciesActorsFileSchema} from '@wildshard/format/speciesBookRows';
import type {EliteCoreScript} from '../../src/shared/game/eliteSystem';
import {nativePopulationOf} from '../../src/server/game/riding/nativePopulation';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

const finite=v.pipe(v.number(),v.finite()),count=v.pipe(finite,v.integer(),v.minValue(0));
const Saved=v.strictObject({version:v.literal(1),captain:v.nullable(v.string()),fight:v.nullable(v.string()),
  line:v.pipe(v.array(v.string()),v.maxLength(8)),elapsed:finite,phase2:v.boolean(),pinned:v.boolean(),
  supports:count,signatures:count,hits:count,core:v.unknown()});
export interface NativeNalatiQara {
  readonly captain:()=>HuntBody|null;
  readonly fight:()=>SpawnScript|null;
  readonly core:ReturnType<typeof nativeEliteCore>;
  readonly advance:(dt:number)=>void;
  readonly scale:(actor:HuntBody,point:Vector3)=>number;
}
const owners=new WeakMap<SimHost,NativeNalatiQara>();
export function nalatiQaraOf(host:SimHost):NativeNalatiQara|undefined{return owners.get(host);}

const prepareQara:PrepareHeadlessRuntime=async preparation=>{
  const product=preparation.product,modules=new Map<string,Uint8Array>();
  const [assembly,actors,rows]=await Promise.all([
    nalatiNativeAssembly().then(input=>v.parse(v.object({constants:v.object({pageElites:v.unknown(),groupRows:v.object({id:v.string()})})}),input)),
    product.json<unknown>('actors/sheep.json').then(input=>v.parse(SpeciesActorsFileSchema,input)),
    readSpawnScript(product,'nalati.qara-charge',modules),
  ]);
  const page=parseEliteEntryPageRows(assembly.constants.pageElites);
  const external=page.borrowed.map(parseExternalElite).find(row=>row.mode==='script');
  const knock=page.actions.find(row=>row.kind==='knockdown');
  if(knock?.kind!=='knockdown')throw new Error('Missing captain knockdown owner');
  if(external===undefined||external.spawn.source!=='rider'||external.def.rule!=='night'||rows.slots.length!==1||rows.slots[0]?.id!=='main')throw new Error('Missing original captain owners');
  const program=actors.species.lookBook.program,module=modules.get(rows.script.module.split('/').at(-1)?.replace('.wasm','')??'');
  if(program===undefined||module===undefined)throw new Error('Missing admitted captain module or condition program');
  const base=await prepareNalatiPatrol(preparation,
    (host,actor,request)=>owners.get(host)?.scale(actor,request.point)??1,
    (host,dt)=>{const owner=owners.get(host);if(owner===undefined)throw new Error('Missing captain before-body owner');owner.advance(dt);});
  return {...base,install:(host,context)=>{
    base.install(host,context);
    const patrol=nalatiPatrolOf(host),population=nativePopulationOf(host),clock=host.dayClock;
    if(patrol===undefined||population===undefined||clock===undefined||owners.has(host))throw new Error('Missing original captain population');
    const env=nativeGroupCollection(host,assembly.constants.groupRows.id).environment;
    if(env===undefined)throw new Error('Missing original captain world effects');
    const decisions=ReturnProgram.native(host,program),core=nativeEliteCore(host,NALATI_ELITE_CONDITIONS,decisions,clock,env),contact=new StrikeRunner();
    const strikes=rows.strikes?.map(row=>({amount:row.row.damage,strike:strikeFromData(row.row)}));
    if(strikes===undefined)throw new Error('Missing original captain contact shapes');
    let captain:HuntBody|null=null,fight:SpawnScript|null=null,line:readonly HuntBody[]=[],elapsed=0,phase2=false,supports=0,signatures=0,hits=0;
    let scope:ReturnType<typeof host.scope.child>|null=null;
    const direction=new Vector3();
    const resolve=(id:string):HuntBody=>{const body=population.bodies.find(row=>row.entityId===id);if(body===undefined)throw new Error('Captain continuation lost original body');return body;};
    const pin=(on:boolean):void=>{
      if(on&&scope===null&&captain!==null){scope=host.scope.child('elite.native-captain');pinBrain(captain,scope);}
      else if(!on){scope?.dispose();scope=null;}
    };
    const script:EliteCoreScript<HuntBody>={
      def:external.def,get animal(){return captain;},canSpawn:()=>patrol.readiness.eligible,
      spawn:()=>{
        if(captain?.alive===true)throw new Error('Captain cannot respawn a live owner');
        const body=patrol.law.spawnRider({x:external.def.lair.x,z:external.def.lair.z,yaw:external.spawn.yaw,variant:external.spawn.variant});
        if(body===null)throw new Error('Original captain population refused spawn');
        fight=SpawnScript.nativePopulation(host,rows,module);fight.adopt('main',body.entityId);captain=body;
      },
      despawn:()=>{pin(false);fight?.interrupt();for(const body of line)if(body.alive)patrol.law.dissolve(body);line=[];
        if(captain!==null)patrol.law.dissolve(captain);captain=null;fight=null;},
      reset:()=>{phase2=false;fight?.interrupt();fight?.signal('main',0);},
      enterPhase2:()=>{phase2=true;},trophy:()=>undefined,
      tick:(dt,time,engaged,leashing)=>{
        if(captain===null||fight===null)return;
        const actor=captain;
        pin(engaged);elapsed+=dt;
        const frame=eliteScriptFrame(external,decisions,fight,elapsed,dt,leadPlayer(host).position,
          {kills:patrol.law.killsTonight,engaged,leashing,phase2,time,line:line.filter(body=>body.alive).length,yaw:()=>actor.yaw});
        elapsed=frame.elapsed;
        for(const effect of frame.effects){
          if(effect.kind==='support'){line=patrol.law.spawnLine({count:effect.count});supports+=line.length;}
          else if(effect.kind==='hit'){
            const strike=strikes.find(row=>row.amount===effect.amount);if(strike===undefined)throw new Error('Undeclared captain contact');
            contact.contact(strike.strike,{actor,target:leadPlayer(host).position,canReach:()=>canReach(actor,leadPlayer(host).position,host.physics),hit:()=>{
            host.combat.hit({source:'env',sourceTags:[`elite.${actor.variant}`,'feel.blow','cover.checked'],target:leadPlayer(host).health,
              amount:effect.amount,point:actor.position,dir:direction.set(0,0,0),cause:{kind:actor.kind,label:actor.label}});
            }});
            const length=Math.hypot(effect.knockX,effect.knockZ)||1;
            env.onKnockdown(effect.knockX/length,effect.knockZ/length,knock.duration);hits++;
          }else if(effect.kind==='cue'&&effect.signature){core.signature(external.def.id);signatures++;}
          else if(effect.kind==='page-bank')throw new Error('Captain cannot emit undeclared page operations');
        }
      },
    };
    core.add(script);
    const owner:NativeNalatiQara={captain:()=>captain,fight:()=>fight,core,advance:dt=>{
      // Removed support/corpse references have no remaining native authority.
      // Their live count and core respawn clocks retain the original rules.
      line=line.filter(body=>population.bodies.includes(body));
      if(captain!==null&&!captain.alive&&!population.bodies.includes(captain)){pin(false);fight?.interrupt();captain=null;fight=null;}
      core.update(dt,host.clock.now);
    },
      scale:(actor,point)=>actor===captain?eliteDamageScale(external,decisions,Number(fight?.state('main')['mode']??0),point.distanceTo(leadPlayer(host).position)):1};
    owners.set(host,owner);host.scope.onDispose(()=>{owners.delete(host);pin(false);});
    host.onStep('nalati.qara',()=>undefined,{
      snapshot:()=>JSON.stringify({version:1,captain:captain?.entityId??null,fight:fight?.snapshot()??null,line:line.map(body=>body.entityId),elapsed,phase2,pinned:scope!==null,supports,signatures,hits,core:core.snapshot()}),
      restore:value=>{
        if(typeof value!=='string')throw new Error('Captain continuation requires original string envelope');
        const parsed:unknown=JSON.parse(value),saved=v.parse(Saved,parsed),commit=core.prepareRestore(saved.core);
        if((saved.captain===null)!==(saved.fight===null)||saved.pinned&&saved.captain===null)throw new Error('Captain continuation lost its fight');
        pin(false);captain=saved.captain===null?null:resolve(saved.captain);
        fight=saved.fight===null?null:SpawnScript.nativePopulation(host,rows,module);if(fight!==null&&saved.fight!==null)fight.restore(saved.fight);
        line=saved.line.map(resolve);elapsed=saved.elapsed;phase2=saved.phase2;supports=saved.supports;signatures=saved.signatures;hits=saved.hits;
        commit();pin(saved.pinned);
      },
    });
  }};
};
/** Same held laws, generic body capsules and original additional rider spheres. */
export const prepareHeadlessRuntime=withNalatiWeapons(prepareQara,(host,from,direction,distance,hit)=>{
  const patrol=nalatiPatrolOf(host);if(patrol===undefined)throw new Error('Missing native patrol contacts');
  return patrol.target(from,direction,distance,hit);
});
