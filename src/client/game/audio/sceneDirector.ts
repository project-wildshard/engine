import { entryOwner } from '../../../shared/game/shardfile/entryOwners';
import { boundResidentWorldScope } from '../shardfile/hybridPresentation';
import type { Tier } from '@wildshard/engine/core/tier';
import { runtimeAudio, installRuntimeAudioEntry, installRuntimeGameplayAudio, type RuntimeGameplayAudioEnvironment } from '../plugin/audio';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { Vector3 } from 'three';
import { parse } from 'valibot';
import { ScalarLatticeBindings } from '@wildshard/engine/world/scalarChannel';
import { AudioSceneSchema, parseSampledAudioPlacement, type AudioScene } from '@wildshard/format/audioScene';
import type { AudioData } from '@wildshard/format/audio';
import type { Audio, HoofSurface, ImpactKind } from '@wildshard/engine/audio/Audio';
import type { Music } from '@wildshard/engine/audio/Music';
import type { Scope } from '@wildshard/engine/app/scope';
import type { Player } from '@wildshard/engine/player/Player';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import { SampledAmbience, PositionalLoops } from '@wildshard/engine/audio/AmbienceBeds';
import { installSfxCredit } from '@wildshard/engine/audio/credits';
import { CuePlayer, cueManifest } from '@wildshard/engine/audio/Cues';
import { castRay } from '@wildshard/engine/physics/query';
import { ambientTick, tap } from '@wildshard/engine/core/harnessTap';
import { windUniforms } from '@wildshard/engine/world/TreeFactory';
import { SetScore } from '@wildshard/engine/audio/SetScore';
import { audioMixValue, requireAudioProfile } from '@wildshard/engine/audio/audioProfiles';
import { panFromYaw, audioRandom } from '@wildshard/engine/audio/util';
import { createCueRouter } from '@wildshard/engine/audio/cueRouting';
import { CombatCues, type CombatCueOpts } from '@wildshard/engine/combat/cues';
import type { ShardContext } from '../plugin/context';
import { installEnteredRuntimeService } from '../shard/retainedHooks';
import { AudioVoicePatches } from './voicePatches';

/** Native polyline observation; returns distance and the direction toward its closest point. */
export function audioPathProbe(points:readonly (readonly [number,number])[],x:number,z:number):{distance:number;x:number;z:number}{
 let distance=Infinity,px=0,pz=0;
 for(let i=0;i<points.length-1;i++){const a=points[i],b=points[i+1];if(a===undefined||b===undefined)continue;const vx=b[0]-a[0],vz=b[1]-a[1],l2=vx*vx+vz*vz,t=l2>0?Math.max(0,Math.min(1,((x-a[0])*vx+(z-a[1])*vz)/l2)):0,ax=a[0]+vx*t,az=a[1]+vz*t,d=Math.hypot(x-ax,z-az);if(d<distance){distance=d;px=ax;pz=az;}}
 return {distance,x:distance>0?(px-x)/distance:0,z:distance>0?(pz-z)/distance:0};
}
/** Client-only zone/cue director. Content supplies rows and numeric observations; all borrowed owners are native. */
export class AudioSceneDirector {
 readonly rows:AudioScene;
 readonly inputs:Record<string,number>;
 private readonly fields=new Map<string,(x:number,z:number)=>number>();
 private readonly lattices=new ScalarLatticeBindings();
 private readonly cues=new CombatCues();
 private readonly point=new Vector3();
 private audio:Audio|null=null;
 voices:AudioVoicePatches|null=null;
 ambience:SampledAmbience|null=null;
 private score:ReturnType<typeof SetScore.declared>|undefined;
 private music:Music|undefined;
 private bedT=0;private chorusT:number;private thrustPending=false;
 constructor(private readonly data:AudioData,private readonly player:Player){
  this.rows=parse(AudioSceneSchema,data.scene);this.inputs={...this.rows.initial};this.chorusT=this.rows.chorus.initial;
  const {res,size,channels}=this.rows.fields;
  for(const [id,encoded]of Object.entries(channels))this.fields.set(id,this.lattices.lattice({res,size,values:Array.isArray(encoded)?{type:'f32',count:res*res,data:encoded.join('')}:encoded}));
 }
 /** Declared raw rasters use the product's verified file intake before publication. */
 get fieldFiles():readonly string[]{return this.lattices.files;}
 prepareFields(blocks:ReadonlyMap<string,Uint8Array>):void{this.lattices.prepare(blocks);}
 /** Native scoped signal subscriptions; weapon ids/phases and creature events are declared rows. */
 listen(ctx:ShardContext):void{
  ctx.on('audio.scene-frame', ({delta,inputs})=>{this.update(delta,inputs);});
  ctx.on('creature.signal',({name,x,z})=>{this.event(name,x,z);});
  ctx.on('weapon.charge',({id,phase,value})=>{for(const row of this.rows.charges){if(row.weapon!==id||row.phase!==phase)continue;if(row.cancelDeferred)this.thrustPending=false;this.cues.cue((value===1&&row.full!==undefined?row.full:row.cue) as `cue.${string}`,{strength:value??1});}});
 }
 /** Re-enter with a fresh lifetime, restoring native hoof, bed and animal-sound owners on exit. */
 bind(a:Audio,music:Music|undefined,animals:RowBodiesView|undefined,scope:Scope):void{
  this.audio=a;this.music=music;
  const previousHoof=a.hoofSurfaceAt,previousBed=a.bedId,previousAnimal=animals&&Object.getOwnPropertyDescriptor(animals,'onSound');
  const hoof=(x:number,z:number):HoofSurface=>this.surfaceAt(x,z);a.hoofSurfaceAt=hoof;
  const voices=new AudioVoicePatches(a,this.data,requireAudioProfile(this.data.patches,'voice patches'),scope);voices.install();this.voices=voices;
  const deferred={start:():void=>{this.thrustPending=true;queueMicrotask(()=>{if(this.thrustPending){this.thrustPending=false;this.voices?.play(this.rows.deferred.cue);}});}};
  this.cues.use(createCueRouter(this.data.routing,{voices:new Map(),bindings:this.data.voiceBindings,owners:new Map<string,object>([['voices',voices],[this.rows.deferred.owner,deferred]])}),scope);
  const animalSound=(name:string,pos:Vector3):void=>{if(name==='hoofsteps'){const who=animals?.animals.find(actor=>actor.position===pos);if(who!==undefined&&!this.rows.hoofKinds.includes(who.kind))return;}a.animal(name,pos,this.player.position,this.player.yaw);};
  if(animals!==undefined)animals.onSound=animalSound;
  a.setAmbient(voices.rows.bed);
  // A set catalogue owns arbitrary bed/hum families in its cue bank. The
  // shared sample overlay retains its original fixed-family path.
  const ownCues=this.data.music?.setCatalogue===undefined||this.data.samples?.catalogue===undefined?undefined:new CuePlayer(a,scope,audioRandom);
  const expected=ownCues===undefined?[]:requireAudioProfile(this.data.samples?.catalogue,'scene loop inventory').loopOrder;
  if(ownCues!==undefined&&expected.length===0)throw new Error('Scene cue bank requires its loop inventory');
  if(ownCues!==undefined){const credit=cueManifest(requireAudioProfile(this.data.samples,'scene sample catalogue').set)?.['credit'];if(typeof credit!=='string')throw new Error('Scene cue bank requires its credit');installSfxCredit(credit,scope);}
  if(ownCues!==undefined)a.onLevelBank(bank=>{ownCues.useBank(bank.cues);},scope);
  if(music!==undefined){const profile=requireAudioProfile(this.data.music,'scene score'),score=SetScore.declared(profile,music,undefined,{styleIndependent:ownCues!==undefined});this.score=score;scope.onDispose(()=>{score.dispose();});scope.onDispose(music.setScore(profile.id,score));a.onLevelBank(bank=>{if(ownCues===undefined||expected.every(id=>bank.cues.loops.has(id)))score.useBank(bank.score);},scope);}
  this.ambience=new SampledAmbience(a,requireAudioProfile(this.data.zones,'scene zones'),ownCues,scope);
  scope.onDispose(()=>{this.ambience?.dispose();this.ambience=null;if(a.hoofSurfaceAt===hoof)a.hoofSurfaceAt=previousHoof;if(a.bedId===voices.rows.bed)a.setAmbient(previousBed);if(animals?.onSound===animalSound){if(previousAnimal===undefined)delete animals.onSound;else Object.defineProperty(animals,'onSound',previousAnimal);}this.audio=null;this.voices=null;this.score=undefined;this.music=undefined;this.thrustPending=false;});
 }
 surfaceAt(x:number,z:number):HoofSurface{
  for(const row of this.rows.surfaces.rules){const hit=row.kind==='rect'?Math.abs(x-row.x)<row.width/2&&Math.abs(z-row.z)<row.depth/2:row.kind==='field'?requireAudioProfile(this.fields.get(row.id),row.id)(x,z)>row.above:row.ids.some(id=>audioPathProbe(requireAudioProfile(this.rows.paths[id],id),x,z).distance<row.below);if(hit)return row.surface;}
  return this.rows.surfaces.fallback;
 }
 emit(name:string,position:Vector3):void{if(this.voices?.rows.calls.some(row=>row.id===name))this.audio?.animal(name,position,this.player.position,this.player.yaw);}
 event(name:string,x:number,z:number):void{const cue=this.rows.events[name];if(cue!==undefined)this.voices?.play(cue,{distance:Math.hypot(x-this.player.position.x,z-this.player.position.z),pan:panFromYaw(x-this.player.position.x,z-this.player.position.z,this.player.yaw,.8)});}
 fire(id:string):boolean{return id.startsWith('cue.')&&this.cues.cue(id as `cue.${string}`);}
 impact(id:string,surface:ImpactKind,pan:number,gain:number):boolean{return id.startsWith('cue.')&&this.cues.cue(id as `cue.${string}`,{surface,pan,gain});}
 counts():Record<string,number>{return {...this.audio?.counts};}
 private value(expr:Parameters<typeof audioMixValue>[0]):number{return audioMixValue(expr,id=>requireAudioProfile(this.inputs[id],id));}
 update(dt:number,observations:Readonly<Record<string,number>>):void{
  Object.assign(this.inputs,observations);const a=this.audio,amb=this.ambience;if(a===null)return;const p=this.player.position;
  this.bedT-=dt;
  if(this.bedT<=0){
   this.bedT=1/requireAudioProfile(this.data.zones,'scene zones').tickHz;
   this.inputs['x']=p.x;this.inputs['z']=p.z;
   for(const [id,field]of this.fields)this.inputs[id]=field(p.x,p.z);
   for(const [id,row]of Object.entries(this.rows.probes)){
    let distance:number,dx:number,dz:number;
    if(row.kind==='point'){dx=row.x-p.x;dz=row.z-p.z;distance=Math.hypot(dx,dz);}
    else if(row.kind==='path'){const probe=audioPathProbe(requireAudioProfile(this.rows.paths[row.path],row.path),p.x,p.z);distance=probe.distance;dx=probe.x;dz=probe.z;}
    else{const profile=requireAudioProfile(this.rows.profiles[row.profile],row.profile),at=Math.max(0,Math.min(profile.values.length-1,(p.x-profile.x0)/profile.step)),i=Math.min(profile.values.length-2,Math.floor(at)),left=requireAudioProfile(profile.values[i],row.profile),right=requireAudioProfile(profile.values[i+1],row.profile),u=at-i;dx=0;dz=left[0]+(right[0]-left[0])*u-p.z;distance=Math.abs(dz)-(left[1]+(right[1]-left[1])*u);}
    this.inputs[`${id}.distance`]=distance;this.inputs[`${id}.pan`]=panFromYaw(dx,dz,this.player.yaw,.7);
    const blend=Math.max(0,Math.min(1,(distance-row.outer)/(row.inner-row.outer)));this.inputs[id]=blend*blend*(3-2*blend)*row.gain;
   }
   for(const [id,expr]of this.rows.values)this.inputs[id]=this.value(expr);
   this.voices?.setGroup(this.rows.voiceGroup,Object.fromEntries(this.rows.voice.map(([id,expr])=>[id,this.value(expr)])));
   if(amb!==null){for(const [id,expr]of this.rows.mix)amb.inputs[id]=this.value(expr);amb.inputs['rain']=this.voices?.observations['rain']??0;amb.inputs['storm']=this.voices?.observations['stormwind']??0;amb.set(amb.inputs);amb.mix();if(a.ready)this.voices?.sampledBed((amb.diag['sampled']??0)>0);}
   if(this.score!==undefined){const before=JSON.stringify(this.score.scene);for(const row of this.rows.score)this.score.scene[row.key]=this.value(row.when)!==0?row.on:row.off;if(amb!==null)this.score.scene['zone']=amb.zone;if(JSON.stringify(this.score.scene)!==before)this.music?.refreshScore();}
  }
  amb?.advance(dt,p,this.player.yaw);
  this.chorusT-=dt;
  if(this.chorusT<=0){const row=this.rows.chorus;this.chorusT=this.value(row.active)!==0?row.wait[0]+audioRandom()*(row.wait[1]-row.wait[0]):row.idle;if(this.value(row.when)!==0){const angle=audioRandom()*Math.PI*2,d=row.distance[0]+audioRandom()*(row.distance[1]-row.distance[0]);this.point.set(p.x+Math.cos(angle)*d,p.y+row.up,p.z+Math.sin(angle)*d);a.animal(row.call,this.point,p,this.player.yaw);}}
 }
}


const enteredScenes=new WeakMap<Scope,WeakMap<ShardProduct,AudioSceneDirector>>();
/** Run an admitted audio entry before the corresponding native lifecycle hook. */
export async function enterDeclaredAudioPhase(ctx: ShardContext, phase: 'kit' | 'play'): Promise<void> {
 const entry = ctx.product.shardfile.audio.entry?.[phase];
 if (entry === undefined) return;
 if (entry.scene === true) { await enterClientAudioScene(ctx); return; }
 const audio = ctx.app.audio;
 if (audio === null) throw new Error('Audio entry requires its native mixer');
 installRuntimeAudioEntry(ctx, phase, { audio, ...(audio.music === null ? {} : { music: audio.music }) });
}
/** Z1 installs one declared director and its signal subscriptions for the entered owner. */
export function installClientAudioScene(ctx:ShardContext):void|Promise<void>{
 const scope=ctx.scope,product=ctx.product,world=ctx.game.runtime?.world;
 if(world===undefined||world===null||scope.disposed||scope.disposing)throw new Error('Audio scene requires an entered world');
 let products=enteredScenes.get(scope);if(products===undefined){products=new WeakMap();enteredScenes.set(scope,products);}
 if(products.has(product))throw new Error('Audio scene is already installed');
 const read=product.file,json=product.json,player=world.player,data=runtimeAudio(ctx,product.shardfile.audio),installed=products,sceneFile=data.sceneFile;
 const validate=():void=>{
  if(scope.disposed||scope.disposing||ctx.scope!==scope||ctx.product!==product||ctx.game.runtime?.world!==world||world.player!==player||product.file!==read||product.json!==json||runtimeAudio(ctx,product.shardfile.audio)!==data)throw new Error('Audio scene owner changed while preparing fields');
 };
 const build=(input:AudioData):void|Promise<void>=>{
  validate();const scene=new AudioSceneDirector(input,player);
  const publish=():void=>{
   validate();if(installed.has(product))throw new Error('Audio scene is already installed');
   scene.listen(ctx);installed.set(product,scene);scope.onDispose(()=>{installed.delete(product);});
  };
  if(scene.fieldFiles.length===0){publish();return;}
  const prepare=async():Promise<void>=>{
   const blocks=await Promise.all(scene.fieldFiles.map(async file=>[file,await read.call(product,file)] as const));
   validate();scene.prepareFields(new Map(blocks));publish();
  };
  return prepare();
 };
 if(sceneFile===undefined)return build(data);
 const prepare=async():Promise<void>=>{
  const scene=parse(AudioSceneSchema,await json.call(product,sceneFile));validate();
  const hydrated={...data,scene};delete hydrated.sceneFile;await build(hydrated);
 };
 return prepare();
}
/** Native bindings borrow the installed audio scene and supply their numeric observations. */
export function clientAudioScene(ctx:ShardContext):AudioSceneDirector{
 const scene=enteredScenes.get(ctx.scope)?.get(ctx.product);if(scene===undefined||ctx.scope.disposed)throw new Error('Audio scene is not installed');return scene;
}
/** Resolve only finite, typed loans before the existing audio phase effects.
 * Numeric bounds and near points came from the admitted build-time rows; null
 * floors remain gaps rather than resurrecting retired world-object fields. */
function gameplayAudioEnvironment(ctx:ShardContext,row:NonNullable<NonNullable<AudioData['gameplay']>['entryEnvironment']>,tier:Tier):RuntimeGameplayAudioEnvironment {
 const scope=boundResidentWorldScope(ctx.scope)??ctx.scope;
 if(scope.disposed||scope.disposing||ctx.scope.disposed||ctx.scope.disposing||!ctx.scope.belongsTo(scope))throw new Error('Gameplay audio construction has ended');
 const floors=Object.fromEntries(Object.entries(row.floors).map(([id,loans])=>[id,loans.map(loan=>loan===null?null:entryOwner(ctx.scope,'floor',loan))]));
 const dusk=entryOwner(ctx.scope,'buildings',row.dusk),point=entryOwner(ctx.scope,'object',row.emitter.point);
 return {scope,floors,dusk,emitter:{...row.emitter,point},publish:row.publish,
   bounds:Object.fromEntries(Object.entries(row.bounds).map(([id,bounds])=>[id,bounds??undefined])),
   near:Object.fromEntries(Object.entries(row.near).map(([id,points])=>[id,points[tier]]))};
}
/** Bind the admitted director to the actual page's native audio and cue owners.
 * Re-entry restores the same subscriptions without any content callback ports. */
export async function enterClientAudioScene(ctx:ShardContext):Promise<void>{
 const data=runtimeAudio(ctx,ctx.product.shardfile.audio);
 if(data.sampledScene!==undefined){await installSampledAudioScene(ctx,data);return;}
 if(data.scene===undefined&&data.gameplay!==undefined){
  const runtime=ctx.game.runtime;if(runtime?.world===undefined||runtime.world===null||runtime.play===null)throw new Error('Audio scene requires its native world');
  const {audio,music}=runtime.play,{game,sky,player}=runtime.world;
  const constants:Record<string,object>={};for(const [key,value]of Object.entries(data.gameplay.constants??{})){if(typeof value!=='object'||value===null)throw new Error('Invalid audio constant owner');constants[key]=value;}
  const environment=data.gameplay.entryEnvironment===undefined?undefined:gameplayAudioEnvironment(ctx,data.gameplay.entryEnvironment,game.tier);
  installRuntimeAudioEntry(ctx,'play',{audio,music});
  await installRuntimeGameplayAudio(ctx,{audio,music,camera:game.camera,listener:player,objects:runtime.objects,owners:{...constants,sky,world:runtime.objects,wind:windUniforms}},environment);return;
 }
 const scene=clientAudioScene(ctx),play=ctx.game.runtime?.play;
 if(play===undefined||play===null)throw new Error('Audio scene requires its actual play owner');
 installEnteredRuntimeService(ctx,scope=>{
  scene.bind(play.audio,play.music,play.animals,scope);const point=new Vector3();
  ctx.app.events.on('creature.sound',({cue,x,y,z})=>{point.set(x,y,z);scene.emit(cue,point);},scope);
  play.cues.use((id,options)=>options.surface===undefined?scene.fire(id):scene.impact(id,options.surface==='flesh'||options.surface==='wood'?options.surface:'ground',options.pan??0,options.gain??1),scope);
 });
}

/** Sample strategy of the scene director. Rows own recipes and observations;
 * the native entered scope owns the bank, ray query, clocks and loop sources. */
async function installSampledAudioScene(ctx:ShardContext,data:AudioData):Promise<void>{
 const row=requireAudioProfile(data.sampledScene,'sample scene'),profile=requireAudioProfile(data.zones,'sample zones'),musicProfile=requireAudioProfile(data.music,'sample score');
 const audio=ctx.app.audio;if(audio?.music===null||audio===null)throw new Error('Sample scene requires audio/music');
 const music=audio.music,random=():number=>ctx.app.rng.stream('cosmetic').next(),scope=ctx.scope;
 const player=new CuePlayer(audio,scope,random),score=SetScore.declared(musicProfile,music);
 scope.onDispose(music.setScore(musicProfile.id,score));scope.onDispose(()=>{score.dispose();});
 let step=0;
 const voices=new Map<string,(opts:CombatCueOpts)=>boolean|undefined>(Object.entries(row.voices).map(([id,voice])=>[id,opts=>{
  if(!voice.handled)return false;tap.sound?.(voice.tap);
  return player.play(voice.family+(voice.sequence?String(step):''),{...opts,...(voice.pan===undefined?{}:{pan:opts.pan??(random()-.5)*voice.pan})});
 }]));
 voices.set(row.step.id,opts=>{step=step%row.step.count+1;const id=row.step.voices[opts.surface??'']??row.step.fallback;return requireAudioProfile(voices.get(id),id)({...opts,gain:opts.sprinting?row.step.runGain:row.step.walkGain});});
 const routing=createCueRouter(data.routing,{voices});audio.installCues(routing,scope);
 audio.onLevelBank(bank=>{player.useBank(bank.cues);score.useBank(bank.score);},scope);
 const priorSurface=audio.stepSurface;
 audio.stepSurface=()=>{const pos=audio.listenerPosition,physics=ctx.app.physics;if(pos===null||physics===null)return row.fallback;const hit=castRay(physics,{x:pos.x,y:pos.y+.4,z:pos.z},{x:0,y:-1,z:0},1.5);return row.surfaces[hit?.material??'']??row.fallback;};
 scope.onDispose(()=>{audio.stepSurface=priorSurface;});
 const beds=new SampledAmbience(audio,profile,player,scope);scope.onDispose(()=>{beds.dispose();});
 audio.installBeds(requireAudioProfile(profile.beds,'sample beds').map(bed=>bed.id),scope,()=>beds.audible.length);
 const pointSource=row.points[ctx.cube===null?'standalone':'cell'];
 const points=parseSampledAudioPlacement(await ctx.product.json(typeof pointSource==='string'?pointSource:pointSource.file),pointSource).poses.map(({x,y,z})=>new Vector3(x,y,z));
 if(scope.disposed)throw new Error('Sample scene left while reading its points');
 const positional=requireAudioProfile(profile.positional,'positional profile');
 const loops=new PositionalLoops(audio,scope,points,()=>player.loop(positional.sample),()=>{tap.sound?.(row.loopTap,'ambient');},random,positional.max,positional.reach);
 const eye=new Vector3();let since=0;
 ctx.system({id:row.system,phase:'update',after:['engine.player.update'],run:dt=>{
  const pos=audio.listenerPosition;if(pos===null||ctx.app.clock.paused)return;since+=dt;if(since<1/profile.tickHz)return;
  const elapsed=since;since=0;
  ambientTick(row.tick,()=>{
   beds.set({x:pos.x,z:pos.z});let changed=false;for(const binding of row.score){const value=requireAudioProfile(beds.values.get(binding.value),binding.value);if(score.scene[binding.key]!==value){score.scene[binding.key]=value;changed=true;}}if(changed)music.refreshScore();
   beds.mix();eye.copy(pos);eye.y+=row.eye;loops.update(eye,audio.listenerYaw);beds.inputs['worldOn']=Number(!audio.worldMuted);beds.advance(elapsed,pos,audio.listenerYaw);
  });
 }});
 ctx.debug.expose(row.debug,{score:musicProfile.id,beds:audio.bedIds,[row.countLabel]:()=>loops.count});
}
