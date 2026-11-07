import type { AudioData } from '@wildshard/format/audio';
import type { AudioBank } from '@wildshard/format/audioBank';
import type { Scope } from '../../../shared/engine/app/scope';
import { app } from '../app/runtime';
import { tap } from '../../../shared/engine/core/harnessTap';
import { getSfxSet } from '../ui/Settings';
import { CueCatalogue, type SampleClip } from './Cues';
import { cachedBytes, decodeBytes } from './preload';
import { impact, renderPcm } from './gen';
import { spatialAudio } from './util';
import { audioLog } from './audioLog';
import type { Audio } from './Audio';
import type { VoiceTable, PlayOpts } from './Voices';
import type { AudioRead } from './SetScore';

export interface DeclaredBankAudio extends Pick<Audio,'ready'|'listenerYaw'|'ambient'|'shot'|'playPhrase'> {
 readonly voices:Pick<Audio['voices'],'register'|'prewarm'|'playback'>;
}
const shared=new Map<string,WeakRef<Map<string,SampleClip[]>>>();
const catalogues=new WeakMap<Map<string,SampleClip[]>,Set<WeakRef<CueCatalogue>>>();
/** Live boot/playback catalogues share sprite slices; the memo never owns retired PCM. */
export function declaredCatalogue(row:NonNullable<AudioBank['catalogue']>,read:AudioRead=cachedBytes):CueCatalogue {
 let clips=shared.get(row.set)?.deref();if(clips===undefined){clips=new Map();shared.set(row.set,new WeakRef(clips));}
 const catalogue=new CueCatalogue(row.set,read,decodeBytes,{...row,available:()=>getSfxSet()!=='synth',shared:clips});
 let users=catalogues.get(clips);if(users===undefined){users=new Set();catalogues.set(clips,users);}
 users.add(new WeakRef(catalogue));return catalogue;
}
// Boot profiles borrow the map; only live playback catalogues own its decoded lifetime.
const borrowers=new WeakMap<Map<string,SampleClip[]>,Set<WeakRef<CueCatalogue>>>();
function ownCatalogue(catalogue:CueCatalogue,key:string,scope?:Scope):void {
 const clips=shared.get(key)?.deref();if(clips===undefined)throw new Error('Missing shared catalogue clips');
 let users=borrowers.get(clips);if(users===undefined){users=new Set();borrowers.set(clips,users);}
 const live=users,ref=new WeakRef(catalogue);live.add(ref);
 scope?.onDispose(()=>{
  catalogue.dispose();live.delete(ref);
  for(const user of live)if(user.deref()===undefined)live.delete(user);
  if(live.size===0){
   const loans=catalogues.get(clips);for(const loan of loans??[])loan.deref()?.dispose();
   loans?.clear();clips.clear();
  }
 });
}
/** Native bank construction owns generator closures; the caller supplies only validated recipes. */
export function declaredVoiceTable(rows:Pick<AudioData,'bank'|'pcm'>):VoiceTable {
 const families=rows.bank?.families??{};
 return Object.fromEntries(Object.entries(families).map(([id,row])=>{
  const source=row.source;
  if(source.kind==='impact')return [id,{...row,gen:(sr:number,seed:number)=>impact(source.material,sr,seed)}];
  const program=rows.pcm?.[source.id];if(program===undefined)throw new Error(`Missing PCM program: ${source.id}`);
  return [id,{...row,gen:(sr:number,seed:number)=>renderPcm(program,sr,seed)}];
 }));
}
/** Sample/procedural playback, grouped barks and positional sample-first phrases on the existing voice pool. */
export class DeclaredSoundBank {
 readonly playback:ReturnType<Audio['voices']['playback']>;
 private readonly samples:CueCatalogue|undefined;
 private readonly lastBark=new Map<string,string>();
 private readonly bank:AudioBank;
 private readonly audio:DeclaredBankAudio;
 private readonly rows:Pick<AudioData,'bank'|'playback'|'pcm'|'synth'>;
 constructor(audio:DeclaredBankAudio,rows:Pick<AudioData,'bank'|'playback'|'pcm'|'synth'>,scope?:Scope){
  this.audio=audio;this.rows=rows;
  const bank=rows.bank,playback=rows.playback;
  if(bank===undefined||playback===undefined)throw new Error('Missing declared sound bank');
  // Validate every procedural/phrase reference before registration changes a pool.
  const table=declaredVoiceTable(rows);
  for(const row of Object.values(bank.spatial))if(rows.synth?.[row.phrase]===undefined)throw new Error(`Missing phrase: ${row.phrase}`);
  this.bank=bank;this.samples=bank.catalogue===undefined?undefined:declaredCatalogue(bank.catalogue);
  const catalogue=this.samples;
  if(catalogue!==undefined&&bank.catalogue!==undefined)ownCatalogue(catalogue,bank.catalogue.set,scope);
  this.playback=audio.voices.playback(playback,catalogue===undefined?undefined:{available:()=>catalogue.available,samples:{clips:id=>catalogue.clips(id),load:id=>{catalogue.load(id);}}});
  audio.voices.register(table,scope);
 }
 /** Membership is authored independently of whether the selected sample set is decoded. */
 acceptsShot(id:string):boolean{return this.bank.shots?.includes(id)===true;}
 get catalogue():CueCatalogue {if(this.samples===undefined)throw new Error('Sound bank has no sample catalogue');return this.samples;}
 prewarm(families:readonly string[]):void {if(this.samples===undefined)this.audio.voices.prewarm(families);else this.samples.prewarm(families);}
 shot(family:string,options:PlayOpts={}):boolean {const ok=this.playback.play('shot',{family},options);audioLog('sfx',family,ok);return ok;}
 barks(group:string):string[]{
  const prefix=this.bank.barks?.prefix;if(prefix===undefined)throw new Error('Sound bank has no bark policy');
  const rows=this.catalogue.manifest?.['oneshots'];
  return typeof rows==='object'&&rows!==null&&!Array.isArray(rows)?Object.keys(rows).filter(id=>id.startsWith(`${prefix}${group}-`)).sort():[];
 }
 bark(group:string,at?:{x:number;y:number;z:number}):boolean {
  const all=this.barks(group);
  if(all.length===0){audioLog('bark',group,false,'none shipped');return false;}
  const ready=all.filter(id=>this.catalogue.clips(id)!==undefined);if(ready.length<all.length)this.prewarm(all);
  const pool=ready.length>1?ready.filter(id=>id!==this.lastBark.get(group)):ready;
  const id=pool[app.rng.stream('cosmetic').int(0,pool.length-1)];
  if(id===undefined){audioLog('bark',group,false,'not decoded');return false;}
  this.lastBark.set(group,id);
  const ok=this.playback.play('shot',{family:id},{at,gain:this.bank.barks?.gain??1});audioLog('bark',group,ok,id);return ok;
 }
 /** Full 3D range and attenuation; sample refusal alone selects the declared phrase. */
 spatial(id:string,position:{x:number;y:number;z:number},listener:{x:number;y:number;z:number},yaw: number=this.audio.listenerYaw):void {
  const row=this.bank.spatial[id];if(row===undefined)throw new Error(`Unknown positional phrase: ${id}`);
  tap.sound?.(row.startTap);if(!this.audio.ready)return;
  const spatial=spatialAudio(position,listener,yaw,row.reach,row.scale,row.power);if(spatial===null)return;
  tap.sound?.(row.tap);const {pan,gain}=spatial;
  if(this.audio.shot(row.sample,{pan,gain,out:this.audio.ambient}))return;
  const phrase=this.rows.synth?.[row.phrase];if(phrase===undefined)throw new Error(`Missing phrase: ${row.phrase}`);
  this.audio.playPhrase(phrase,this.audio.ambient,{pan,gain});
 }
}
