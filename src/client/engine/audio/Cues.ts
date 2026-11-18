import { cueFamilyNames, cueFile, cueFiles, cueManifest, cueShotFiles, cueSprite, type CueSprite } from '../../../shared/engine/audio/bootAudio';
import { compactSampleLoop, decodeSampleLoop, sampleClip } from './preload';
import { TIER } from '../core/tier';
import type { SampleLoop } from './Audio';
import type { AudioMixer } from './levelAudio';
import type { AudioRead, AudioDecode } from './SetScore';
import type { VoicePool } from './Voices';
import type { Scope } from '../../../shared/engine/app/scope';
import type { Vector3 } from 'three';

export interface SampleClip { buffer: AudioBuffer; offset: number; duration: number; gain: number }
export interface CueBank { loops: Map<string, SampleLoop>; shots: Map<string, SampleClip[]> }
export interface CueOpts {
  pan?: number; gain?: number; strength?: number; sprinting?: boolean; surface?: string;
  point?: Vector3; dir?: Vector3 | -1 | 1; speed?: number; heavy?: boolean; kind?: string;
}
export type CueMap = (id: string, opts: CueOpts) => boolean;
const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number): number => typeof v === 'number' && Number.isFinite(v) ? v : d;

/** Cut named slices on one buffer, retaining each caller's end tolerance and gain policy. */
export function cutCueSprite(manifest:Record<string,unknown>|undefined,sprite:CueSprite,buffer:AudioBuffer,
  into:Map<string,SampleClip[]>,policy:{tolerance:number;arrayFamilies:boolean;familyGain:boolean}):void {
  const families=manifest?.['oneshots'];if(!obj(families))return;
  for(const [family,value]of Object.entries(families)){
    if(!policy.arrayFamilies&&(!obj(value)||!Array.isArray(value['files'])))continue;
    const clips:SampleClip[]=[];
    for(const name of cueFamilyNames(manifest,family)){
      const clip=sprite.clips.get(name);
      if(clip!==undefined&&clip.offset+clip.duration<=buffer.duration+policy.tolerance)clips.push({buffer,offset:clip.offset,duration:clip.duration,gain:policy.familyGain&&obj(value)?num(value['gain'],1):1});
    }
    if(clips.length>0)into.set(family,clips);
  }
}

/** Decoded loop metadata; the native emitter decides whether its declared zone is live. */
export type CatalogueLoop = SampleLoop & {zone:string|undefined;live:boolean};
/** One catalogue's decoding/cache policies, retaining eager bank and lazy family semantics. */
export interface CueCataloguePolicy {
  tolerance:number;arrayFamilies:boolean;familyGain:boolean;loopGain:number;
  available?:()=>boolean;shared?:Map<string,SampleClip[]>;compactSprite?:boolean;
}
const CUE_CATALOGUE_POLICY:CueCataloguePolicy={tolerance:0.05,arrayFamilies:false,familyGain:true,loopGain:1};
const spriteLoads = new WeakMap<Map<string, SampleClip[]>, Promise<void>>();
/** Same recording bytes and slice offsets, with owned lazy promises and a shared boot-clip loan. */
export class CueCatalogue {
  readonly manifest:Record<string,unknown>|undefined;
  private disposed=false;
  private readonly loops=new Map<string,SampleLoop>();
  private readonly shots=new Map<string,SampleClip[]>();
  private readonly beds=new Map<string,Promise<CatalogueLoop|undefined>>();
  private readonly loading=new Set<string>();
  private readonly key:string;private readonly read:AudioRead;private readonly decode:AudioDecode;private readonly policy:CueCataloguePolicy;
  constructor(key:string,read:AudioRead,decode:AudioDecode,policy:CueCataloguePolicy=CUE_CATALOGUE_POLICY) {this.key=key;this.read=read;this.decode=decode;this.policy=policy;this.manifest=cueManifest(key);}
  private live():boolean {return !this.disposed;}
  get available():boolean {return this.live()&&this.manifest!==undefined&&(this.policy.available?.()??true);}
  get decoded():string[] {if(!this.live())return [];return [...new Set([...(this.policy.shared?.keys()??[]),...this.shots.keys()])];}
  clips(family:string):SampleClip[]|undefined {if(!this.live())return undefined;return this.shots.get(family)??this.policy.shared?.get(family);}
  /** Release owned decoded loans at runtime retirement; other catalogues keep their shared slices. */
  dispose():void {this.disposed=true;this.loops.clear();this.shots.clear();this.beds.clear();this.loading.clear();}
  private files(family:string):string[] {return cueFamilyNames(this.manifest,family).map(name=>cueFile(this.key,name)).filter((url):url is string=>url!==undefined);}
  private whole(buffer:AudioBuffer,gain=1):SampleClip {return {buffer,offset:0,duration:buffer.duration,gain};}
  private decodeSprite(sprite: CueSprite): Promise<void> {
    const into = this.policy.shared ?? this.shots;
    if (into.size > 0) return Promise.resolve();
    const pending = spriteLoads.get(into);
    if (pending) return pending;
    const work = this.fillSprite(sprite, into).finally(() => { spriteLoads.delete(into); });
    spriteLoads.set(into, work);
    return work;
  }
  private async fillSprite(sprite: CueSprite, into: Map<string, SampleClip[]>): Promise<void> {
    const buffer = await this.decode(await this.read(sprite.url), 'effect');
    if (!this.live()) return;
    if (!this.policy.compactSprite || buffer.sampleRate !== 24000 || buffer.numberOfChannels !== 1) {
      cutCueSprite(this.manifest, sprite, buffer, into, this.policy);
      return;
    }
    const { packCueClips } = await import('./packedCues');
    if (!this.live()) return;
    const clips = new Map<string, SampleClip[]>();
    cutCueSprite(this.manifest, sprite, buffer, clips, this.policy);
    packCueClips(clips, into, sprite.url);
  }
  private loop(buffer:AudioBuffer,row:Record<string,unknown>,url:string):CatalogueLoop {
    const loopEnd=Math.min(buffer.duration,num(row['loopEnd'],buffer.duration)),loopStart=Math.max(0,Math.min(loopEnd-0.05,num(row['loopStart'],0)));
    const packed=compactSampleLoop(buffer,{loopStart,loopEnd},url);
    return {...packed,gain:num(row['gain'],this.policy.loopGain),zone:typeof row['zone']==='string'?row['zone']:undefined,live:row['live']===true};
  }
  bed(name:string):Promise<CatalogueLoop|undefined> {
    const have=this.beds.get(name);if(have!==undefined)return have;
    const pending=(async():Promise<CatalogueLoop|undefined>=>{
      if(!this.available)return undefined;
      const rows=this.manifest?.['beds'],row=obj(rows)?rows[name]:undefined;if(!obj(row))return undefined;
      const url=cueFile(this.key,row['file']);if(url===undefined)return undefined;
      try{
        const sample = await decodeSampleLoop(await this.read(url), row, url, num(row['gain'], this.policy.loopGain), this.decode, 'bed', true);
        return this.live() ? { ...sample, zone: typeof row['zone'] === 'string' ? row['zone'] : undefined, live: row['live'] === true } : undefined;
      }
      catch(error){console.info(`[sfx] ${url}: ${error instanceof Error?error.message:String(error)} — that bed stays silent`);return undefined;}
    })();this.beds.set(name,pending);return pending;
  }
  dropBed(name:string):void {this.beds.delete(name);}
  prewarm(families:readonly string[]):void {for(const family of families)this.load(family);}
  load(family:string):void {
    if(!this.available||this.clips(family)!==undefined||this.loading.has(family))return;
    const sprite=cueSprite(this.key,this.manifest);
    if(sprite!==undefined){
      void (async () => {
        try { await this.decodeSprite(sprite); }
        catch (error) { console.info(`[sfx] ${sprite.url}: ${error instanceof Error ? error.message : String(error)} — the one-shots stay silent for now`); }
      })();
      return;
    }
    const urls=this.files(family);if(urls.length===0)return;this.loading.add(family);
    void(async()=>{const clips:SampleClip[]=[];for(const url of urls){try{clips.push(this.whole(await this.decode(await this.read(url),'effect')));}catch{/* This take remains silent. */}}
      this.loading.delete(family);if(this.live()&&clips.length>0)this.shots.set(family,clips);
    })();
  }
  shotFiles():string[] {return cueShotFiles(this.key);}
  async decodeShots(onFile?:()=>void):Promise<void> {
    const rows=this.manifest?.['oneshots'];if(!this.live()||!obj(rows))return;
    const sprite=cueSprite(this.key,this.manifest),into=this.policy.shared??this.shots;
    if(sprite!==undefined){
      try{await this.decodeSprite(sprite);}
      catch(error){console.info(`[sfx] ${sprite.url}: ${error instanceof Error?error.message:String(error)} — the one-shots decode on first play`);}
      onFile?.();return;
    }
    await Promise.all(Object.keys(rows).map(async family=>{const clips:SampleClip[]=[];
      for(const url of this.files(family)){try{clips.push(this.whole(await this.decode(await this.read(url),'effect')));}catch(error){console.info(`[sfx] ${url}: ${error instanceof Error?error.message:String(error)} — that take is skipped`);}onFile?.();}
      if(this.live()&&clips.length>0)into.set(family,clips);
    }));
  }
  /** Eager banks still decode every counted file concurrently, then admit loops and shots in manifest order. */
  async decodeAll(onFile?:()=>void):Promise<CueBank> {
    const raw=this.manifest,bank={loops:this.loops,shots:this.shots};if(raw===undefined||!this.live())return bank;
    const buffers=new Map<string,AudioBuffer>(),effects=new Set(this.shotFiles());
    const bedRows = rowsByRecording(raw['beds'], this.key);
    const humRows = rowsByRecording(raw['hums'], this.key);
    const beds = new Map<string, SampleLoop>();
    await Promise.all(cueFiles(this.key).map(async url=>{try{
      const rows = bedRows.get(url), row = rows?.[0];
      const effect = effects.has(url), bed = row !== undefined && !humRows.has(url);
      const bytes = await this.read(url);
      if (bed && !effect && rows?.length === 1) {
        beds.set(url, await decodeSampleLoop(bytes, row, url, num(row['gain'], this.policy.loopGain), this.decode, 'bed', true));
      } else {
        buffers.set(url, await this.decode(bytes, effect ? 'effect' : bed ? 'bed' : undefined));
      }}
      catch(error){console.info(`[sfx] ${url}: ${error instanceof Error?error.message:String(error)} — synth kept`);}finally{onFile?.();}}));
    if(!this.live())return bank;
    for(const section of ['beds','hums']){
      const rows=raw[section];if(!obj(rows))continue;
      for(const [name,row] of Object.entries(rows)){
        if(!obj(row))continue;const url=cueFile(this.key,row['file']);if(url===undefined)continue;
        const buffer = buffers.get(url), loop = beds.get(url) ?? (buffer === undefined ? undefined : this.loop(buffer, row, url));
        if(loop !== undefined && loop.loopEnd>loop.loopStart)this.loops.set(`${section==='beds'?'bed':'hum'}.${name}`,loop);
      }
    }
    const sprite=raw['sprite'],rows=raw['oneshots'];if(!obj(rows))return bank;
    if(!obj(sprite)){
      for(const [family,row] of Object.entries(rows)){const clips:SampleClip[]=[];
        for(const name of cueFamilyNames(raw,family)){const url=cueFile(this.key,name),buffer=url===undefined?undefined:buffers.get(url);if(buffer!==undefined && url!==undefined)clips.push(await sampleClip(buffer,obj(row)?num(row['gain'],1):1,url));}
        if(clips.length>0)this.shots.set(family,clips);
      }return bank;
    }
    const parsed=cueSprite(this.key,raw),buffer=parsed===undefined?undefined:buffers.get(parsed.url);
    if(parsed!==undefined&&buffer!==undefined) {
      if (TIER === 'phone' && buffer.sampleRate === 24000 && buffer.numberOfChannels === 1) {
        const { packCueClips } = await import('./packedCues');
        const clips = new Map<string, SampleClip[]>();
        cutCueSprite(this.manifest, parsed, buffer, clips, this.policy);
        packCueClips(clips, this.shots, parsed.url);
      } else cutCueSprite(this.manifest,parsed,buffer,this.shots,this.policy);
    }
    return bank;
  }
}

function rowsByRecording(section: unknown, catalogue: string): Map<string, Record<string, unknown>[]> {
  const files = new Map<string, Record<string, unknown>[]>();
  if (!obj(section)) return files;
  for (const row of Object.values(section)) {
    if (!obj(row)) continue;
    const url = cueFile(catalogue, row['file']);
    if (url === undefined) continue;
    const rows = files.get(url);
    if (rows === undefined) files.set(url, [row]); else rows.push(row);
  }
  return files;
}
/** The loading bar lends its counted read/decode; the catalogue owns the admitted bank. */
export function decodeCueSet(key:string,read:AudioRead,decode:AudioDecode,onFile?:()=>void):Promise<CueBank> {
  return new CueCatalogue(key,read,decode).decodeAll(onFile);
}

/** Content calls tap.sound with its literal id, then asks this shared positional shot player. */
export class CuePlayer {
  private bank: CueBank = { loops: new Map(), shots: new Map() };
  private readonly audio: AudioMixer;
  private readonly scope: Scope;
  private readonly random: () => number;
  private readonly voices: VoicePool;
  constructor(audio: AudioMixer, scope: Scope, random: () => number) { this.audio = audio; this.scope = scope; this.random = random; this.voices = audio.voice(); }
  useBank(bank: CueBank): void { if (!this.scope.disposed) this.bank = bank; }
  loop(id: string): SampleLoop | undefined { return this.bank.loops.get(id); }
  play(family: string, opts: CueOpts = {}): boolean {
    if (this.scope.disposed || !this.audio.ready) return false;
    const clips = this.bank.shots.get(family);
    return clips !== undefined && this.voices.sample(clips, opts, { jitter: 0, panAlways: true }, this.random, this.scope) !== undefined;
  }
}
