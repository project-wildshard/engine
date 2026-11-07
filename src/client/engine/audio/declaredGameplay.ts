import type { Camera } from 'three';
import type { AudioData } from '@wildshard/format/audio';
import type { Scope } from '../../../shared/engine/app/scope';
import type { SystemSpec } from '../app/systems';
import type { Audio } from './Audio';
import type { Music } from './Music';
import { CatalogueScore } from './SetScore';
import { createAudioObserver, requireAudioProfile, type AudioMusicProfile, type AudioObservationEntity, type AudioObservationEvent } from '../../../shared/engine/audio/audioProfiles';
import { audioLog } from './audioLog';
import type { DeclaredSoundBank } from './declaredBank';
import type { DeclaredAmbience } from './declaredAmbience';

/** Output-only native door events. Row-authored sound selection subscribes through Scope. */
export interface DoorMotionEvents extends EventTarget {
  readonly current: { readonly position: { readonly x: number; readonly y: number; readonly z: number }; readonly opening: boolean } | null;
}

/** Native loans only. All observation routing, commands and entry policy come from admitted rows. */
export interface DeclaredGameplayPorts {
  scope?:Scope;audio:Pick<Audio,'ambientShade'|'shadeAmbient'>; music:Music; camera:Camera;
  ambience:Pick<DeclaredAmbience,'night'|'declaredSpots'|'setActive'|'setUnderwater'|'frame'>&{sfx:Pick<DeclaredSoundBank,'shot'>};
  owners:Readonly<Record<string,object|null|undefined>>;
  emitters?:Readonly<Record<string,{update:(camera:Camera)=>void}|null>>;
  dusk?:{setDusk:(value:number)=>void}|null;
  doorChanges?:DoorMotionEvents;
  doors?:{onDoor:(listener:(door:{position:{x:number;y:number;z:number}},opening:boolean)=>void)=>()=>void}|null;
}
interface Reference {owner:string;path:readonly string[]}
/** Bind the existing observer and entry lifetimes without copying their living native owners. */
export function declaredGameplay(rows:{gameplay?:NonNullable<AudioData['gameplay']>;observations?:AudioData['observations'];music?:AudioMusicProfile|undefined},ports:DeclaredGameplayPorts):{
  systems:readonly SystemSpec[];value:(system:string,id:string)=>number;
  diagnostic:{readonly spots:DeclaredAmbience['declaredSpots'];readonly night:boolean};
  enter:(scope:Scope,retained:boolean)=>void;
} {
  const policy=requireAudioProfile(rows.gameplay,'gameplay bindings');
  const profile=policy.score?requireAudioProfile(rows.music,'gameplay score'):undefined;
  const score=profile===undefined?undefined:CatalogueScore.get(ports.music,profile,undefined,false);
  const owners={...ports.owners,ambience:ports.ambience,camera:ports.camera,score};
  const read=(ref:Reference):unknown=>{
    if(!Object.hasOwn(owners,ref.owner))throw new Error(`Missing audio gameplay owner: ${ref.owner}`);
    let value:unknown=Reflect.get(owners,ref.owner);
    for(const key of ref.path){if(value===null||value===undefined)return undefined;if(typeof value!=='object')throw new Error('Invalid audio gameplay path');value=Reflect.get(value,key);}
    return value;
  };
  const inputs=new Map(Object.entries(policy.inputs).map(([id,ref])=>{read(ref);return [id,()=>read(ref)] as const;}));
  const writers=new Map(Object.entries(policy.writers).map(([id,row])=>[id,(value:number):void=>{
    if(row.kind==='dusk'){ports.dusk?.setDusk(value);return;}
    ports.ambience.night=value;
  }] as const));
  const entities=Object.fromEntries(Object.entries(policy.entities).map(([id,ref])=>[id,():readonly AudioObservationEntity[]=>{
    const value=read(ref);if(!Array.isArray(value)||value.length>8192)throw new Error('Invalid audio gameplay roster');
    const list:readonly unknown[]=value;
    if(!list.every((item):item is AudioObservationEntity=>typeof item==='object'&&item!==null&&'kind' in item&&typeof item.kind==='string'&&'state' in item&&typeof item.state==='string'&&'alive' in item&&typeof item.alive==='boolean'&&'position' in item&&typeof item.position==='object'&&item.position!==null&&'x' in item.position&&typeof item.position.x==='number'&&'y' in item.position&&typeof item.position.y==='number'&&'z' in item.position&&typeof item.position.z==='number'))throw new Error('Invalid audio gameplay actor');
    return list;
  }]));
  const controllers=new Map<string,ReturnType<typeof createAudioObserver>>();
  const value=(system:string,id:string):number=>requireAudioProfile(controllers.get(system),'gameplay system').state(id);
  for(const row of Object.values(policy.commands))if(row.kind==='emitter'&&!Object.hasOwn(ports.emitters??{},row.id))throw new Error('Missing gameplay emitter');
  const commands=new Map(Object.entries(policy.commands).map(([id,row])=>[id,(dt:number,_t:number,event:AudioObservationEvent):void=>{
    switch(row.kind){
      case 'scene':requireAudioProfile(score,'gameplay score').setScene(value(row.system,row.state)!==0?row.on:row.off);break;
      case 'combat':ports.music.combat(row.gain);break;
      case 'shot':if(event.entity===undefined)throw new Error('Missing audio observation actor');ports.ambience.sfx.shot(row.family,{at:event.entity.position});break;
      case 'emitter':ports.emitters?.[row.id]?.update(ports.camera);break;
      case 'frame':ports.ambience.frame(dt,ports.camera);break;
      case 'log':{const detail=row.detail===undefined?undefined:read(row.detail)??0;if(detail!==undefined&&typeof detail!=='number')throw new Error('Invalid audio log number');audioLog('wire',event.value===1?row.on:row.off,row.ok,detail?.toFixed(row.precision??0));break;}
      default:throw new Error('Unknown audio gameplay command');
    }
  }] as const));
  for(const row of requireAudioProfile(rows.observations,'gameplay observations'))controllers.set(row.id,createAudioObserver(row,{inputs,writers,entities,commands}));
  const systems=(rows.observations??[]).map((row):SystemSpec=>({id:row.id,phase:'update',after:row.after,before:row.before,run:(dt,t)=>{controllers.get(row.id)?.run(dt,t);}}));
  const diagnostic={spots:ports.ambience.declaredSpots,get night(){const row=policy.diagnostic;return row===undefined?false:value(row.system,row.state)!==0;}};
  return {systems,value,diagnostic,enter:(scope,retained)=>{
    const previousShade=ports.audio.ambientShade;
    if(retained&&policy.activate)ports.ambience.setActive(true);
    const doors=policy.doors;
    const changes=ports.doorChanges;
    if(doors!==undefined&&changes!==undefined)scope.listen(changes,'door',()=>{const change=changes.current;if(change!==null)ports.ambience.sfx.shot(change.opening?doors.open:doors.close,{at:change.position});});
    const stop=doors===undefined||changes!==undefined?undefined:ports.doors?.onDoor((door,opening)=>{ports.ambience.sfx.shot(opening?doors.open:doors.close,{at:door.position});});
    if(retained)scope.onDispose(()=>{stop?.();if(policy.activate)ports.ambience.setActive(false);if(policy.restoreShade)ports.audio.shadeAmbient(previousShade.level,previousShade.cutoff);});
  }};
}
