import type { Camera } from 'three';
import { Scope } from '../../../shared/engine/app/scope';
import { resourceScope } from '../../../shared/engine/app/resources';
import type { AudioData } from '@wildshard/format/audio';
import type { Audio } from './Audio';
import { AmbienceMix, AmbienceZones, type AmbienceMixPorts } from './ambience';
import { audioMixValue, requireAudioProfile, type AudioZoneProfile } from '../../../shared/engine/audio/audioProfiles';
import { DeclaredSoundBank } from './declaredBank';
import { audioLog } from './audioLog';
import { AudioSurfaceMap, GROUND_SURFACES, type StepSurface } from './surface';
import { terrainHeight } from '../../../shared/engine/world/terrainHeight';
import { floorAtRects, type FloorRect } from '../../../shared/engine/physics/box';
import { audioRandom } from './util';

/** A scene cell's self-contained synth beds. One bed has no rectangle and covers open ground. */
export function sceneZoneProfile(profile: AudioZoneProfile | undefined): boolean {
  return profile?.graph !== undefined && profile.rectangles !== undefined && profile.beds !== undefined
    && profile.blendMetres !== undefined && profile.lifecycle === undefined && profile.sampleMix === undefined
    && profile.routing === undefined && profile.nodes === undefined && profile.schedules === undefined && profile.positional === undefined;
}

/** Blend rectangle edges, with any remaining weight going to open ground. */
export function sceneZoneWeights(profile: AudioZoneProfile, at: { readonly x: number; readonly z: number }): ReadonlyMap<string, number> {
  const weights = new Map<string, number>();
  let strongest = 0;
  for (const box of profile.rectangles ?? []) {
    const dx = Math.max(box.x0 - at.x, 0, at.x - box.x1), dz = Math.max(box.z0 - at.z, 0, at.z - box.z1);
    const weight = Math.max(0, 1 - Math.hypot(dx, dz) / (profile.blendMetres ?? 1));
    weights.set(box.zone, Math.max(weights.get(box.zone) ?? 0, weight));
    strongest = Math.max(strongest, weight);
  }
  const total = Math.max(1, [...weights.values()].reduce((sum, weight) => sum + weight, 1 - strongest));
  return new Map((profile.beds ?? []).map(row => [row.id, (weights.get(row.zone) ?? 1 - strongest) / total]));
}

/** A short reflection on declared wet beds. The feedback gain stays below one even at full send. */
function sceneEcho(audio: Audio, source: GainNode, level: number, scope: Scope): void {
  const delay = audio.ctx.createDelay(), reflection = audio.ctx.createGain();
  delay.delayTime.value = 0.17; reflection.gain.value = level * 0.6;
  source.connect(delay).connect(reflection);
  reflection.connect(audio.bus('ambience')); reflection.connect(delay);
  scope.onDispose(() => { delay.disconnect(); reflection.disconnect(); });
}

/** The graph and its interval belong to the entered scene, and first allocate after audio unlock. */
export function installSceneZones(audio: Audio, scope: Scope, profile: AudioZoneProfile, feet: () => { readonly x: number; readonly z: number } | null): void {
  if (!sceneZoneProfile(profile)) throw new Error('Scene audio requires a rectangular synth profile');
  const graph = requireAudioProfile(profile.graph, 'scene synth graph'), beds = requireAudioProfile(profile.beds, 'scene synth beds');
  const names = new Set(beds.map(row => row.id)), regions = new Set(profile.rectangles?.map(row => row.zone));
  if (beds.filter(row => !regions.has(row.zone)).length !== 1 || graph.beds.length !== beds.length
    || graph.beds.some(row => !names.has(row.id)) || beds.some(row => profile.levels[row.id] === undefined)) {
    throw new Error('Scene audio needs one open-ground bed and a level for every synth bed');
  }
  const zones = new AmbienceZones(audio, audioRandom, scope);
  let gains: ReadonlyMap<string, GainNode> | undefined, selected: string | undefined;
  scope.interval(1000 / profile.tickHz, () => {
    const at = feet();
    if (at === null || !audio.ready) return;
    if (gains === undefined) {
      gains = audio.createSynthBeds(zones, audioRandom).assemble(graph, { ambient: audio.bus('ambience') }).beds;
      for (const [id, gain] of gains) {
        const wet = profile.wet[id] ?? 0;
        if (wet > 0) sceneEcho(audio, gain, wet, scope);
      }
    }
    const weights = sceneZoneWeights(profile, at);
    let dominant: string | undefined, strongest = 0;
    for (const [id, gain] of gains) {
      const weight = weights.get(id) ?? 0;
      gain.gain.setTargetAtTime(weight * (profile.levels[id] ?? 0), audio.ctx.currentTime, profile.smoothSeconds);
      if (weight > strongest) { dominant = id; strongest = weight; }
    }
    if (dominant !== undefined && dominant !== selected) { selected = dominant; audioLog('zone', dominant); }
  });
}

/** Audio content required by the native ambience phase. */
export type DeclaredAmbienceData=Pick<AudioData,'bank'|'playback'|'pcm'|'synth'|'ambience'|'surfaces'>&{zones?:AudioZoneProfile|undefined};
/** Native spatial capabilities; content, numeric reads and lifetime policy remain in the audio section. */
export interface DeclaredAmbiencePorts extends Pick<AmbienceMixPorts,'sea'|'sites'|'objects'|'bounds'|'near'|'points'> {
  audio:Audio;scope?:Scope;
  /** Defaults to the native active terrain query; tests can lend an isolated terrain fixture. */
  heightAt?:AmbienceMixPorts['heightAt'];
  owners?:Readonly<Record<string,object|null|undefined>>;
  floorRows?:Readonly<Record<string,readonly FloorRect[]>>;
}
/** Immutable spatial facts; live gain reads use declared native owner bindings. */
export interface DeclaredAudioSpot {zone:string;x:number;z:number;r:number;fade?:number;open?:boolean}
const SURFACES:readonly StepSurface[]=[...GROUND_SURFACES,'litter','gravel','mud','wet','metal'];
function pointsOf(value:unknown):readonly {x:number;z:number}[]{
 if(value===undefined)return [];if(!Array.isArray(value)||value.length>2048)throw new Error('Invalid ambience point list');
 const points:readonly unknown[]=value;
 if(!points.every((point):point is {x:number;z:number}=>typeof point==='object'&&point!==null&&'x' in point&&'z' in point&&typeof point.x==='number'&&typeof point.z==='number'))throw new Error('Invalid ambience point');
 return points;
}
/** The existing mixer and voice bank, with one declared owner for timers, beds and numeric inputs. */
export class DeclaredAmbience {
  readonly scope:Scope;
  readonly routing:AmbienceMix;
  readonly inputs:Record<string,number>;
  readonly diag:Record<string,number|string[]|Record<string,number>>;
  readonly declaredSpots:readonly DeclaredAudioSpot[];
  private readonly spots:DeclaredAudioSpot[];
  private readonly surfaces:AudioSurfaceMap<StepSurface>|undefined;
  private readonly bank:DeclaredSoundBank|undefined;
  private readonly disposal:'scope'|'samples';
  constructor(rows:DeclaredAmbienceData,ports:DeclaredAmbiencePorts,Mix:typeof AmbienceMix=AmbienceMix){
    const profile=requireAudioProfile(rows.zones,'ambience zones'),policy=requireAudioProfile(profile.lifecycle,'ambience lifecycle'),heightAt=ports.heightAt??terrainHeight;
    if(ports.scope?.disposed)throw new Error('Audio scope is disposed');
    const owner=(reference:{owner:string;path:readonly string[]}):unknown=>{let value:unknown=ports.owners?.[reference.owner];for(const field of reference.path){if(value===null||value===undefined)return undefined;if(typeof value!=='object')throw new Error('Missing ambience spatial owner');value=Reflect.get(value,field);}return value;};
    const known=new Set(['mix','values',...Object.keys(ports.owners??{})]);
    const inputs=new Set<string>();
    for(const row of policy.inputs){
      if(inputs.has(row.id))throw new Error('Duplicate ambience input');
      if(row.kind==='read'&&!known.has(row.owner))throw new Error(`Missing ambience input owner: ${row.owner}`);
      if(row.kind==='value'){
        const pending=[row.value];while(pending.length>0){const value=pending.pop();if(typeof value==='string'&&!inputs.has(value))throw new Error('Ambience input must read an earlier input');if(typeof value==='object')pending.push(...value.slice(1));}
      }
      inputs.add(row.id);
    }
    for(const reference of [...Object.values(policy.circles),...Object.values(policy.pointLists),...Object.values(policy.spotBindings).map(row=>row.gain)])if(!Object.hasOwn(ports.owners??{},reference.owner))throw new Error(`Missing ambience spatial owner: ${reference.owner}`);
    if(policy.wind&&rows.ambience===null)throw new Error('Missing ambience wind');
    this.scope=policy.childScope?(ports.scope??resourceScope()).child(policy.scope):new Scope(policy.scope);
    this.disposal=policy.dispose;this.inputs={...policy.values};
    const sends:Record<string,number>={};for(const row of profile.routing?.rooms.list??[])sends[row.id]=0;
    this.diag=Object.fromEntries((profile.mix?.diag??[]).map(([id])=>[id,0]));this.diag['beds']=[];this.diag['sends']=sends;
    this.bank=policy.bank?new DeclaredSoundBank(ports.audio,rows,this.scope):undefined;
    const bank=this.bank,wind=policy.wind?ports.audio.windBed(requireAudioProfile(rows.ambience??undefined,'ambience wind')):undefined;
    const reads:Record<string,()=>number>={};
    const read=(id:string):number=>{const resolve=reads[id];if(resolve===undefined)throw new Error(`Missing ambience input: ${id}`);return resolve();};
    for(const row of policy.inputs)reads[row.id]=row.kind==='value'?()=>audioMixValue(row.value,read):()=>{
      let value:unknown=row.owner==='mix'?this.routing:row.owner==='values'?this.inputs:ports.owners?.[row.owner];
      for(const field of row.path){if(typeof value!=='object'||value===null)throw new Error('Missing ambience numeric path');value=Reflect.get(value,field);}
      if(typeof value!=='number'||!Number.isFinite(value))throw new Error('Invalid ambience numeric input');return value;
    };
    const points={...ports.points,...Object.fromEntries(Object.entries(policy.points??{}).map(([id,row])=>{
      const x=audioMixValue(row.x,read),z=audioMixValue(row.z,read);
      return [id,{x,z,...(row.height===undefined?{}:{y:heightAt(x,z)+audioMixValue(row.height,read)})}];
    }))};
    const circles:NonNullable<AmbienceMixPorts['circles']>=Object.fromEntries(Object.entries(policy.circles).map(([id,reference])=>[id,()=>{
      const point=owner(reference);if(point===undefined)return undefined;
      if(typeof point!=='object'||point===null||!('x' in point)||!('z' in point)||!('r' in point)||typeof point.x!=='number'||typeof point.z!=='number'||typeof point.r!=='number')throw new Error('Invalid ambience circle');
      return point.r>0?{x:point.x,z:point.z,r:point.r}:undefined;
    }]));
    const pointLists:NonNullable<AmbienceMixPorts['pointLists']>=Object.fromEntries(Object.entries(policy.pointLists).map(([id,reference])=>[id,()=>pointsOf(owner(reference))]));
    const allowed=new Set(profile.routing?.zoneNames),spots:(DeclaredAudioSpot&{gain?:()=>number})[]=[];
    if(policy.spots)for(const row of profile.zones){
      const binding=row.source===undefined?undefined:policy.spotBindings[row.source],zone=binding?.zone??row.source;
      if(zone===undefined||!allowed.has(zone))throw new Error('Unknown ambience spot zone');
      spots.push({zone,x:row.x,z:row.z,r:row.inner,fade:row.fade??row.outer-row.inner,...(row.open===undefined?{}:{open:row.open}),...(binding===undefined?{}:{gain:()=>{const value=owner(binding.gain)??0;if(typeof value!=='number')throw new Error('Invalid ambience spot gain');return value>binding.above?1:0;}})});
    }
    this.spots=spots;this.declaredSpots=[...spots];
    const floors=Object.fromEntries(Object.entries(ports.floorRows??{}).map(([id,rects])=>[id,{floorHeightAt:(x:number,z:number)=>floorAtRects(rects,x,z,'first')}]));
    this.surfaces=policy.surfaces?new AudioSurfaceMap(requireAudioProfile(rows.surfaces,'ambience surfaces'),SURFACES,{heightAt,sea:ports.sea,floors:Object.fromEntries(Object.entries(floors).map(([id,floor])=>[id,[floor]])),values:Object.fromEntries(Object.keys(this.inputs).map(id=>[id,()=>this.inputs[id]??0])),circles}):undefined;
    this.routing=new Mix(ports.audio,profile,{
      ...ports,points,heightAt,floors,circles,pointLists,spots:{spots:()=>spots},random:audioRandom,scope:this.scope,...(policy.ownedZones&&ports.scope!==undefined?{zoneScope:this.scope}:{}),inputs:reads,
      ...(bank===undefined?{}:{sample:{available:()=>bank.catalogue.available,load:id=>bank.catalogue.bed(id),drop:id=>{bank.catalogue.dropBed(id);}},
        sampleLive:ids=>{this.diag['beds']=ids;},listener:(x,y,z,yaw)=>{bank.playback.listener(x,y,z,yaw);},shot:(family,options)=>bank.shot(family,options)}),
      diagnostic:(id,value)=>{this.diag[id]=value;},roomWeight:(id,value)=>{sends[id]=value;},
      onZone:zone=>{if(policy.logZone)audioLog('zone',zone);},...(wind===undefined?{}:{onBuild:()=>{wind.zone();}}),
    },policy.zone);
    if(wind!==undefined)ports.audio.installSynthBed(requireAudioProfile(rows.ambience??undefined,'ambience wind').bed,wind,this.scope);
  }
  addSpot(spot:DeclaredAudioSpot):void{this.spots.push(spot);}
  stepSurface(x:number,z:number,y:number):StepSurface{return requireAudioProfile(this.surfaces,'ambience surfaces').surfaceAt(x,z,y);}
  get sfx():DeclaredSoundBank {return requireAudioProfile(this.bank,'ambience sound bank');}
  get zone():string{return this.routing.zone;}
  get night():number{return this.routing.night;}
  set night(value:number){this.routing.night=value;}
  update(dt:number,camera:Camera):void{this.routing.frame(dt,camera);}
  frame(dt:number,camera:Camera):void{this.routing.frame(dt,camera);}
  setUnderwater(on:boolean):void{this.routing.setUnderwater(on);}
  setActive(on:boolean):void{this.routing.setActive(on);}
  dispose():void{if(this.disposal==='scope')this.routing.dispose();else{this.routing.dropSchedules();this.routing.dropSamples();}}
}
