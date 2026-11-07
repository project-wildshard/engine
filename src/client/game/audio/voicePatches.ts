import { parse } from 'valibot';
import { VoicePatchesSchema, type VoicePatches } from '@wildshard/format/voicePatches';
import type { AudioData } from '@wildshard/format/audio';
import type { Audio } from '@wildshard/engine/audio/Audio';
import { audioMixValue, requireAudioProfile } from '@wildshard/engine/audio/audioProfiles';
import { audioRandom } from '@wildshard/engine/audio/util';
import { ownAudioSource } from '@wildshard/engine/audio/ownership';
import type { Scope } from '@wildshard/engine/app/scope';
import { ambientTick, tap } from '@wildshard/engine/core/harnessTap';

type Group=VoicePatches['groups'][string];
interface Live {scope:Scope;gains:Map<string,GainNode>;filters:Map<string,BiquadFilterNode>}
const mixers=new WeakMap<Audio,AudioVoicePatches>();
/** each admitted rows object's parse, once (G639: every cell entry re-parsed it inside a ~180 ms Nalati activation frame) */
const admitted=new WeakMap<object,VoicePatches>();
/** Client-only patch interpreter. Native mixers own samples/envelopes; rows own every voice, layer and bed. */
export class AudioVoicePatches {
 readonly rows:VoicePatches;
 readonly inputs:Record<string,number>;
 readonly observations:Record<string,number>={};
 private readonly groups=new Map<string,Live>();
 private readonly last=new Map<string,number>();
 private sampled=false;
 constructor(private readonly audio:Audio,private readonly data:AudioData,input:unknown,private readonly scope:Scope){
  const known=typeof input==='object'&&input!==null?admitted.get(input):undefined;
  this.rows=known??parse(VoicePatchesSchema,input);if(known===undefined&&typeof input==='object'&&input!==null)admitted.set(input,this.rows);this.inputs={...this.rows.initial};
  for(const row of Object.values(this.rows.cues)){
   if(row.phrase!==undefined)requireAudioProfile(data.synth?.[row.phrase],row.phrase);
   for(const layer of row.layers)requireAudioProfile(this.rows.cues[layer.cue],layer.cue);
  }
  scope.onDispose(()=>{for(const id of this.groups.keys())this.stop(id);if(mixers.get(audio)===this)mixers.delete(audio);});
 }
 /** Install call ids and the declared bed under the entered lifetime. No audio context is created here. */
 install():void{
  const a=this.audio,table:Record<string,Parameters<Audio['registerCalls']>[0][string]>={};
  for(const row of this.rows.calls)table[row.id]={...(row.gap===undefined?{}:{gap:row.gap}),...(row.reach===undefined?{}:{reach:row.reach}),...(row.sampled===undefined?{}:{sampled:row.sampled}),play:(t,bus,at)=>{
   this.play(row.cue,{at:t,distance:at.dist},row.surface===true?(a.hoofSurfaceAt?.(at.position.x,at.position.z)??'grass'):undefined,bus);
  }};
  a.registerCalls(table,this.scope);
  a.installSynthBed(this.rows.bed,{start:()=>{for(const [id,row]of Object.entries(this.rows.groups))if(!row.persistent)this.start(id,row);},stop:()=>{for(const [id,row]of Object.entries(this.rows.groups))if(!row.persistent)this.stop(id);}},this.scope);
  mixers.set(a,this);
 }
 /** Named cue plus scalar observations and an optional surface id. */
 play(id:string,params:Readonly<Record<string,number>>={},surface?:string,out?:AudioNode,depth=0,work?:{calls:number}):void{
  const budget=work??{calls:0};
  if(depth>4||++budget.calls>256)throw new Error('Voice layer recursion bound');
  const row=requireAudioProfile(this.rows.cues[id],id),a=this.audio;
  if(!a.ready||this.scope.disposed)return;
  const input:Record<string,number>={...this.inputs,...row.defaults,...params,wood:surface===undefined?(params['wood']??0):Number(surface==='wood'),gravel:surface===undefined?(params['gravel']??0):Number(surface==='gravel'),flesh:surface===undefined?(params['flesh']??0):Number(surface==='flesh')};
  input['at']??=a.ctx.currentTime;
  const value=(expr:Parameters<typeof audioMixValue>[0]):number=>audioMixValue(expr,key=>key==='random'?audioRandom():requireAudioProfile(input[key],key));
  for(const [key,expr]of row.values)input[key]=value(expr);
  if(row.when!==undefined&&value(row.when)===0)return;
  const t=input['at']??a.ctx.currentTime;
  if(row.throttle!==undefined&&(input['force']??0)===0&&t-(this.last.get(id)??0)<value(row.throttle))return;
  this.last.set(id,t);
  if(row.tap!==undefined){tap.sound?.(row.tap);a.tally(row.tap);}
  let bus=out??a.sfx;
  if(row.bus!==undefined){const gain=a.ctx.createGain();gain.gain.value=value(row.bus.gain);const lp=a.ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=value(row.bus.cutoff);gain.connect(lp);a.route(lp,value(row.bus.pan),bus);bus=gain;}
  let sampled=false;
  if(row.sample!==undefined&&(row.sample.when===undefined||value(row.sample.when)!==0)){
   const sample=row.sample,surfaceId=surface??((input['wood']??0)>0?'wood':(input['gravel']??0)>0?'gravel':'grass'),family=sample.id+(sample.surface?`-${sample.variants?.[surfaceId]??surfaceId}`:'');
   let target=bus;
   if(sample.cutoff!==undefined&&a.hasShot(family)){const lp=a.ctx.createBiquadFilter();lp.type='lowpass';lp.frequency.value=value(sample.cutoff);a.route(lp,sample.pan===undefined?0:value(sample.pan),bus);target=lp;}
   sampled=a.shot(family,{out:target,t:t+value(sample.delay),gain:value(sample.gain),rate:value(sample.rate),...(sample.pan===undefined||target!==bus?{}:{pan:value(sample.pan)})});
  }
  if(!sampled&&row.phrase!==undefined)a.playPhrase(requireAudioProfile(this.data.synth?.[row.phrase],row.phrase),bus,input);
  for(const layer of row.layers){if(sampled&&!layer.afterSample)continue;for(let i=0;i<layer.count;i++){const next:Record<string,number>={...input,i};for(const [key,expr]of layer.values)next[key]=value(expr);this.play(layer.cue,next,surface,bus,depth+1,budget);}}
 }
 /** Bed controls use numeric observations; decoded layers suppress only their declared synth group. */
 setGroup(id:string,patch:Readonly<Record<string,number>>):void{
  Object.assign(this.inputs,patch);Object.assign(this.observations,patch);const row=requireAudioProfile(this.rows.groups[id],id),a=this.audio;
  const sunk=row.sampleSinks.some(key=>a.loop(key)!==undefined);
  if(sunk)for(const key of row.sampleInputs)this.inputs[key]=0;
  if(!a.ready)return;
  if(row.persistent&&!this.groups.has(id)&&this.value(row.active)!==0)this.start(id,row);
  const live=this.groups.get(id);if(live===undefined||(this.sampled&&!row.persistent))return;
  for(const control of row.controls){const param=control.param==='gain'?live.gains.get(control.target)?.gain:live.filters.get(control.target)?.frequency;if(param===undefined)throw new Error('Missing voice control target');param.setTargetAtTime(this.value(control.value),a.ctx.currentTime,control.tau);}
 }
 sampledBed(on:boolean):void{if(on===this.sampled)return;this.sampled=on;this.inputs['sampled']=Number(on);this.inputs['missingCamp']=Number(this.audio.loop('camp')===undefined);this.audio.restartSynthBed(this.rows.bed);}
 private value(expr:Parameters<typeof audioMixValue>[0]):number{return audioMixValue(expr,id=>requireAudioProfile(this.inputs[id],id));}
 private stop(id:string):void{this.groups.get(id)?.scope.dispose();this.groups.delete(id);}
 private start(id:string,row:Group):void{
  if(this.groups.has(id))return;
  const a=this.audio,scope=this.scope.child(`audio.patch.${id}`),gains=new Map<string,GainNode>(),filters=new Map<string,BiquadFilterNode>();
  const sources:AudioScheduledSourceNode[]=[],outputs:GainNode[]=[];
  scope.onDispose(()=>{for(const node of outputs)node.disconnect();for(const source of sources){try{source.stop();}catch{/* Already stopped by the native bed owner. */}source.disconnect();}});
  this.groups.set(id,{scope,gains,filters});
  if(!this.sampled||row.persistent){
   for(const wind of row.winds){const gain=a.mkWind(...wind.args);gains.set(wind.id,gain);outputs.push(gain);}
   for(const noise of row.noise){
    const src=ownAudioSource(a.ctx.createBufferSource());src.buffer=a.noise;src.loop=true;src.playbackRate.value=noise.rate[0]+audioRandom()*(noise.rate[1]-noise.rate[0]);src.start(0,audioRandom()*noise.offset);sources.push(src);
    let tail:AudioNode=src;
    for(const [index,[type,f,q]]of noise.filters.entries()){const node=a.ctx.createBiquadFilter();node.type=type;node.frequency.value=f;node.Q.value=q;tail.connect(node);tail=node;filters.set(`${noise.id}.${index}`,node);}
    const gain=a.ctx.createGain();gain.gain.value=0;tail.connect(gain).connect(a.ambient);gains.set(noise.id,gain);outputs.push(gain);
   }
   for(const lfo of row.lfos){const target=requireAudioProfile(gains.get(lfo.target),lfo.target),source=ownAudioSource(a.ctx.createOscillator()),gain=a.ctx.createGain();source.frequency.value=lfo.rate;gain.gain.value=lfo.depth;source.connect(gain).connect(target.gain);source.start();sources.push(source);}
   this.setGroup(id,{});
  }
  for(const schedule of row.schedules){
   const later=():void=>{scope.timeout((schedule.wait[0]+audioRandom()*(schedule.wait[1]-schedule.wait[0]))*1000,()=>{ambientTick(schedule.tick,()=>{
    if(a.ambientOn&&a.bedId===this.rows.bed&&this.value(schedule.when)!==0){const params:Record<string,number>={};for(const [key,expr]of schedule.values)params[key]=this.value(expr);this.play(schedule.cue,params,undefined,a.ambient);}later();
   });});};later();
  }
 }
}
/** Resolve only a mixer whose entered owner installed its patch rows. */
export function audioVoicePatches(audio:Audio):AudioVoicePatches{return requireAudioProfile(mixers.get(audio),'installed voice patches');}
