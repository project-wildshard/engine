import { scoreManifest, shipped, type ScoreSet, type StemSting, type BossPhase, type MusicStyle } from '../../../shared/engine/audio/bootAudio';
import type { SlotAudio, StyleBank } from './Stems';
import type { Audio } from './Audio';
import type { Music, MusicState } from './Music';
import type { Scope } from '../../../shared/engine/app/scope';
import type { AudioMusicProfile } from '../../../shared/engine/audio/audioProfiles';
import { selectScoreSlots } from './scoreSelection';

/** reads a stem file's bytes (fetch by default; a test hands its own) */
export type AudioRead = (url: string) => Promise<ArrayBuffer>;
/** decodes a stem's bytes into an AudioBuffer (the audio context by default; a test hands its own) */
export type AudioDecode = (bytes: ArrayBuffer) => Promise<AudioBuffer>;
/** a set's decoded score: every slot's stems and the stings, ready for SetScore to play */
export interface ScoreBank { slots: Map<string, SlotAudio>; stings: Map<StemSting, AudioBuffer> }
export interface ScoreSource {
  /** A self-contained recording set bypasses unrelated preferred-style failures. */
  readonly styleIndependent?: boolean;
  readonly slots: readonly string[];
  /** The base-style slot used by this source before its scene-specific recordings. */
  readonly base?: string;
  readonly synthLead?: 'pluck' | 'marimba';
  readonly minFade?: number;
  readonly phase?: BossPhase;
  readonly sceneName?: string;
  readonly failures?: Iterable<string>;
  sting?: (name: StemSting) => AudioBuffer | undefined | Promise<AudioBuffer | undefined>;
  onDeck?: (slot: string) => void;
  target: (state: MusicState) => string | undefined;
  want: (playing: string | undefined) => SlotAudio | undefined;
  readonly pending: boolean;
  useBank: (bank: ScoreBank) => void;
  readonly stings: Map<StemSting, AudioBuffer>;
}
const STINGS: readonly StemSting[] = ['pickup', 'death', 'chunk'];
/** Decode the requested stems only; absent or invalid files keep the next fallback or synth. */
export async function decodeScore(set: ScoreSet, slots: readonly string[], read: AudioRead, decode: AudioDecode,
  withStings: boolean, onFile?: () => void): Promise<ScoreBank> {
  const bank: ScoreBank = { slots: new Map(), stings: new Map() }, m = scoreManifest(set);
  if (!m) return bank;
  const one = async (file: string): Promise<AudioBuffer> => {
    try {
      const url = `${set.dir}${file}`;
      if (!shipped(url)) throw new Error(`${url} is not in this build`);
      return await decode(await read(url));
    } finally { onFile?.(); }
  };
  await Promise.all([
    ...slots.map(async (slot) => {
      const spec = m.slots[slot];
      if (!spec) return;
      try {
        const [calm, tension, ...layers] = await Promise.all([one(spec.calm), spec.tension === undefined ? Promise.resolve(undefined) : one(spec.tension), ...spec.layers.map(one)]);
        if (spec.loopEnd > calm.duration + 0.05) throw new Error(`${slot}: loopEnd ${spec.loopEnd} past the file (${calm.duration.toFixed(2)} s)`);
        const aligned = (b: AudioBuffer | undefined): b is AudioBuffer => b !== undefined && Math.abs(b.duration - calm.duration) < 0.05;
        if (!layers.every(aligned)) throw new Error(`${slot}: a layer's length differs from the base`);
        bank.slots.set(slot, { genre: 'folk', slot, spec, calm, tension: aligned(tension) ? tension : undefined, layers });
      } catch (error) { console.info(`[music] ${set.manifestKey}/${slot}: ${error instanceof Error ? error.message : String(error)} — the synth or another slot plays`); }
    }),
    ...(withStings ? STINGS : []).map(async (key) => {
      const file = m.stings[key];
      if (file !== undefined) try { bank.stings.set(key, await one(file)); } catch { /* Keep the existing sting. */ }
    }),
  ]);
  return bank;
}
export interface SetScoreOptions<Scene> extends ScoreSet {
  scene: Scene;
  pick: (scene: Scene, state: MusicState | undefined) => readonly string[];
  read: AudioRead; decode: AudioDecode; onReady: () => void;
  waitForBank?: boolean;
  /** Admitted minimum crossfade and fallback synth lead; omission keeps Music's existing defaults. */
  styleIndependent?: boolean;
  minFade?: number; synthLead?: 'pluck' | 'marimba';
}
/** One score set; only the playing and wanted slots retain PCM across scene changes. */
export class SetScore<Scene> implements ScoreSource {
  /** Bind admitted scene defaults and music-state selection to the existing set decoder. */
  static declared(profile:AudioMusicProfile,music:Pick<Music,'refreshScore'>,io?:{read:AudioRead;decode:AudioDecode},policyOptions?:{styleIndependent?:boolean}):SetScore<Record<string,number|boolean|string|null>> {
    const source=profile.source,policy=profile.setPlayback;
    if(source===null||policy===undefined)throw new Error('Missing declared score set');
    const ports=io??{read:(url:string)=>import('./preload').then(({cachedBytes})=>cachedBytes(url)),decode:(bytes:ArrayBuffer)=>import('./preload').then(({decodeBytes})=>decodeBytes(bytes))};
    return new SetScore({...source,...ports,...policyOptions,onReady:()=>{music.refreshScore();},minFade:profile.minFade,synthLead:profile.synthLead,scene:{...policy.scene},waitForBank:policy.waitForBank,
      pick:(scene,state)=>selectScoreSlots(profile.selection,profile.selectMode,{...scene,...(policy.stateMode?{mode:state?.mode??null}:{})})});
  }
  readonly styleIndependent: boolean;
  readonly scene: Scene;
  readonly minFade?: number;
  readonly synthLead?: 'pluck' | 'marimba';
  readonly slots: readonly string[];
  stings: Map<StemSting, AudioBuffer> = new Map<StemSting, AudioBuffer>();
  private readonly residentSlots = new Map<string, SlotAudio>();
  private readonly failed = new Set<string>();
  private decoding: string | undefined;
  private state: MusicState | undefined;
  private disposed = false;
  private waitingBoot: boolean;
  private readonly options: SetScoreOptions<Scene>;
  readonly log: { slot: string; ms: number }[] = [];
  constructor(options: SetScoreOptions<Scene>) {
    this.options = options;
    this.styleIndependent = options.styleIndependent ?? false;
    if (options.minFade !== undefined) this.minFade = options.minFade;
    if (options.synthLead !== undefined) this.synthLead = options.synthLead;
    this.waitingBoot = options.waitForBank ?? false;
    this.scene = options.scene;
    this.slots = Object.keys(scoreManifest(options)?.slots ?? {});
  }
  get available(): boolean { return this.slots.length > 0; }
  get resident(): string[] { return [...this.residentSlots.keys()]; }
  get pending(): boolean { return this.waitingBoot || this.decoding !== undefined; }
  /** Music has installed the new deck; only its fading predecessor still needs the outgoing PCM. */
  onDeck(slot: string): void {
    const wanted = this.target();
    for (const key of this.residentSlots.keys()) if (key !== slot && key !== wanted) this.residentSlots.delete(key);
  }
  useBank(bank: ScoreBank): void {
    if (this.disposed) return;
    this.waitingBoot = false;
    for (const [key, value] of bank.slots) this.residentSlots.set(key, value);
    if (bank.stings.size > 0) this.stings = bank.stings;
    this.options.onReady();
  }
  target(state: MusicState | undefined = this.state): string | undefined {
    this.state = state;
    if (this.disposed) return undefined;
    return this.options.pick(this.scene, state).find((key) => this.slots.includes(key) && !this.failed.has(key));
  }
  want(playing: string | undefined): SlotAudio | undefined {
    if (this.waitingBoot) return undefined;
    const slot = this.target();
    if (slot === undefined) return undefined;
    for (const key of this.residentSlots.keys()) if (key !== slot && key !== playing) this.residentSlots.delete(key);
    const got = this.residentSlots.get(slot);
    if (got) return got;
    if (this.decoding === undefined) {
      this.decoding = slot;
      const start = performance.now();
      void decodeScore(this.options, [slot], this.options.read, this.options.decode, this.stings.size === 0).then((bank) => {
        this.decoding = undefined;
        if (this.disposed) return undefined;
        const audio = bank.slots.get(slot);
        if (audio) { this.residentSlots.set(slot, audio); this.log.push({ slot, ms: Math.round(performance.now() - start) }); }
        else this.failed.add(slot);
        if (bank.stings.size > 0) this.stings = bank.stings;
        this.options.onReady();
        return undefined;
      });
    }
    return undefined;
  }
  sting(name: StemSting): AudioBuffer | undefined { return this.stings.get(name); }
  dispose(): void { this.disposed = true; this.residentSlots.clear(); this.stings.clear(); }
}


/** Declared score catalogue: shared lazy decoding, scope cancellation and resident
 * fallback. Slot mode retains a base theme plus one scene; bank mode retains the
 * boot bank. The music deck still owns playback, envelopes and bar-grid clocks.
 */
const residentCatalogueScores=new WeakMap<Music,Map<string,CatalogueScore>>();

export class CatalogueScore implements ScoreSource {
  /** Reuse an authored resident score only when its lifecycle explicitly declares that policy. */
  static get(music:Music,profile:AudioMusicProfile,scope?:Scope,rebind=true):CatalogueScore {
    const policy=profile.lifecycle;if(policy===undefined)throw new Error('Missing score lifecycle');
    const existing=policy.persistent?residentCatalogueScores.get(music)?.get(profile.id):undefined;
    if(existing!==undefined){if(rebind)existing.bindProfile(profile);return existing;}
    const source=new CatalogueScore(music,profile,scope);
    const bank=music.residentBank();if(bank!==undefined)source.useStyleBank(bank);
    if(policy.persistent){music.setScore(profile.id,source);let sources=residentCatalogueScores.get(music);if(sources===undefined){sources=new Map();residentCatalogueScores.set(music,sources);}sources.set(profile.id,source);}
    return source;
  }
  /** Bind banks and teardown in the original entered order. */
  static install(audio:Pick<Audio,'onLevelBank'>,music:Music,scope:Scope,profile:AudioMusicProfile):CatalogueScore {
    const policy=profile.lifecycle;if(policy===undefined)throw new Error('Missing score lifecycle');
    const source=CatalogueScore.get(music,profile,policy.persistent?undefined:scope);
    if(policy.persistent)source.attach(scope);
    scope.onDispose(music.setScore(profile.id,source));
    audio.onLevelBank(bank=>{if(bank.title!==undefined)source.useStyleBank(bank.title);},scope);
    if(policy.dispose)scope.onDispose(()=>{source.dispose();});
    return source;
  }
  private logChange(id:string):void {if(this.profile.lifecycle?.logChanges)void import('./audioLog').then(({audioLog})=>audioLog('music',id));}
  setScene(scene:string):void {if(scene===this.sceneName)return;this.sceneName=scene;this.logChange(`scene:${scene}`);if(scene===this.profile.lifecycle?.bossScene)this.phase=1;this.music.refreshScore();}
  setBossPhase(phase:BossPhase):void {if(phase===this.phase)return;this.phase=phase;this.logChange(`phase:${phase}`);this.music.refreshScore();}
  combat(intensity:number):void {this.music.combat(intensity);}
  playSting(name:'chunk'|'death'|'pickup'):void {this.music.sting(name);}

  protected readonly music: Pick<Music,'genre'|'state'|'refreshScore'|'combat'|'sting'>;
  protected profile: AudioMusicProfile;
  protected scope: Scope | undefined;
  private retired = false;
  readonly stings: Map<StemSting, AudioBuffer> = new Map<StemSting,AudioBuffer>();
  readonly failures: Set<string> = new Set<string>();
  sceneName = 'day';
  phase: BossPhase = 1;
  private theme: SlotAudio | undefined;
  private extra: { genre:MusicStyle; slot:SlotAudio|undefined; stings:Map<StemSting,AudioBuffer> } | undefined;
  private bank: StyleBank | undefined;
  private decoding = new Set<string>();
  private bankDecoding: MusicStyle | undefined;
  private genre: MusicStyle | undefined;
  constructor(music:Pick<Music,'genre'|'state'|'refreshScore'|'combat'|'sting'>,profile:AudioMusicProfile,scope?:Scope) {
    if (profile.catalogue === undefined) throw new Error('Missing declared score catalogue');
    this.music=music; this.profile=profile;
    if(scope!==undefined)this.attach(scope);
  }
  get base():string { return this.profile.base; }
  get slots():readonly string[] { return this.profile.slots; }
  get synthLead():AudioMusicProfile['synthLead'] { return this.profile.synthLead; }
  get minFade():number { return this.profile.minFade; }
  get pending():boolean { return this.decoding.size>0 || this.bankDecoding!==undefined; }
  target(_state:MusicState):string { return selectScoreSlots(this.profile.selection,this.profile.selectMode,{scene:this.sceneName})[0]??this.base; }
  bindProfile(profile:AudioMusicProfile):void {
    if(JSON.stringify(profile)===JSON.stringify(this.profile)) return;
    if(this.scope!==undefined && !this.scope.disposed) throw new Error('Cannot replace an entered score profile');
    if(profile.catalogue===undefined) throw new Error('Missing declared score catalogue');
    this.profile=profile; this.theme=undefined; this.extra=undefined; this.bank=undefined; this.stings.clear(); this.failures.clear();
  }
  useBank(bank:ScoreBank):void {
    if(this.profile.catalogue?.mode==='slots') { const theme=bank.slots.get(this.base); if(theme!==undefined){this.theme=theme;this.stings.clear();} }
    for(const [name,buffer] of bank.stings)this.stings.set(name,buffer);
  }
  useStyleBank(bank:StyleBank):void {
    if(this.profile.catalogue?.mode==='bank'){this.bank=bank;this.stings.clear();}
    this.useBank(bank);
  }
  want(_playing:string|undefined):SlotAudio|undefined {
    if(this.retired)return undefined;
    const genre=this.music.genre;
    if(this.profile.catalogue?.mode==='bank') {
      if(genre==='synth'||this.scope?.disposed)return undefined;
      if(this.bank?.genre===genre)return this.bank.slots.get(this.base);
      if(this.bankDecoding===genre||this.failures.has(genre))return undefined;
      this.bankDecoding=genre; void this.prepareBank(genre); return undefined;
    }
    const want=this.target(this.music.state);
    if(genre!==this.genre){this.genre=genre;this.failures.clear();}
    if(genre==='synth')return undefined;
    if(want!==this.base){const slot=this.extra?.genre===genre?this.extra.slot:undefined;if(slot?.slot===want)return slot;this.prepare(genre,want);}
    if(this.theme?.genre===genre)return this.theme;
    this.prepare(genre,this.base);return undefined;
  }
  private async prepareBank(genre:MusicStyle):Promise<void> {
    try {
      const [{decodeStyle},{cachedBytes,decodeBytes}]=await Promise.all([import('./Stems'),import('./preload')]);
      const bank=await decodeStyle(genre,this.profile.bootSlots,cachedBytes,decodeBytes);
      if(!this.retired&&!this.scope?.disposed&&this.music.genre===genre)this.useStyleBank(bank);
    } catch { this.failures.add(genre); }
    finally {if(this.bankDecoding===genre)this.bankDecoding=undefined;if(!this.retired&&!this.scope?.disposed)this.music.refreshScore();}
  }
  private prepare(genre:MusicStyle,slot:string):void {
    const key=`${genre}/${slot}`;
    if(this.retired||this.decoding.has(key)||this.failures.has(key)||this.scope?.disposed)return;
    const owner=this.scope,profile=this.profile;this.decoding.add(key);
    void(async()=>{
      let bank:StyleBank|undefined;
      try {
        const [{decodeStyle},{cachedBytes,decodeBytes}]=await Promise.all([import('./Stems'),import('./preload')]);
        bank=await decodeStyle(genre,[slot],cachedBytes,decodeBytes,undefined,profile.sets[slot]??'base',slot===this.base?undefined:profile.catalogue?.extraStings);
      } catch(error){console.info(`[music] ${profile.id} ${key}: ${error instanceof Error?error.message:String(error)} — the theme plays`);}
      finally{this.decoding.delete(key);}
      if(owner?.disposed||this.scope!==owner||this.profile!==profile)return;
      const audio=bank?.slots.get(slot);if(audio===undefined){this.failures.add(key);return;}
      if(this.music.genre!==genre||this.scope?.disposed)return;
      if(slot===this.base&&bank!==undefined)this.useStyleBank(bank);
      else {
        const stings=new Map(this.extra?.genre===genre?this.extra.stings:[]);
        for(const [name,buffer] of bank?.stings??[])stings.set(name,buffer);
        this.extra={genre,slot:audio,stings};
      }
      this.music.refreshScore();
    })();
  }
  async sting(name:StemSting):Promise<AudioBuffer|undefined> {
    if(this.retired)return undefined;
    const set=this.profile.catalogue?.stingSets[name];if(set===undefined)return this.stings.get(name);
    const genre=this.music.genre,owner=this.scope,profile=this.profile;
    const have=this.extra?.genre===genre?this.extra.stings.get(name):undefined;if(have!==undefined)return have;
    try {
      const [{decodeStyle},{cachedBytes,decodeBytes}]=await Promise.all([import('./Stems'),import('./preload')]);
      const bank=await decodeStyle(genre,[],cachedBytes,decodeBytes,undefined,set,[name]);
      if(owner?.disposed||this.scope!==owner||this.profile!==profile)return undefined;
      const buffer=bank.stings.get(name);
      if(buffer!==undefined&&this.music.genre===genre&&!this.scope?.disposed){const stings=new Map(this.extra?.genre===genre?this.extra.stings:[]);stings.set(name,buffer);this.extra={genre,slot:this.extra?.genre===genre?this.extra.slot:undefined,stings};}
      return buffer;
    } catch {return undefined;}
  }
  attach(scope:Scope):void {
    this.scope=scope;this.retired=false;
    scope.onDispose(()=>{
      if(this.scope!==scope)return;
      this.scope=undefined;this.retired=true;
      this.theme=undefined;this.extra=undefined;this.stings.clear();
    });
  }
  dispose():void {this.bank=undefined;this.stings.clear();this.failures.clear();}
}
