import type { AudioLoopEmitterRecipe, AudioSurfaceRecipe, AudioLoopGraph } from '@wildshard/format/audioProfiles';
import { SynthBeds } from './synth';
import { LoopEmitter, type LoopEmitterPorts, type LoopEmitterVoice, AmbienceZones } from './ambience';
import { resourceScope } from '../../../shared/engine/app/resources';
import { observeAudioMemory } from '../../../shared/engine/core/memoryResources';
import { loopAt, audioRandom, spatialAudio, WindGustBed } from './util';
import { PlayerVoices } from './playerVoices';
import { AudioSurfaceMap, type AudioSurfacePorts } from './surface';
import { ownAudioSource } from './ownership';
import { currentOwner } from '../../../shared/engine/app/ownership';
import { tap, ambientTick } from '../../../shared/engine/core/harnessTap';
import type { Vector3 } from 'three';
import { getSfxSet } from '../ui/Settings';
import { setSfxCredit } from './credits';
import type { SfxBank } from './preload';
import { Voices } from './Voices';
import type { Scope } from '../../../shared/engine/app/scope';
import type { CueMap, CueOpts } from './Cues';
import type { Music } from './Music';
import type { LevelAudioBank } from './levelAudio';
import { audioUnlocked, claimPageAudioContext, releasePageAudioContext, resumePageAudioContext, whenAudioUnlocked } from './unlock';
import type { SfxSet } from '../../../shared/engine/audio/bootAudio';

/**
 * Audio — every sound is synthesised with WebAudio (no files).
 *
 *   const audio = new Audio();          // safe to construct before any gesture (context stays suspended)
 *   audio.resume();                     // call on the first user gesture (ENTER THE CHUNK click / keydown)
 *   audio.listenerYaw = player.yaw;     // each frame, for stereo panning of positional sounds
 *
 *   audio.pickupHum(on)                                           // the pickup orb's hum while inside its prompt radius
 *   audio.dodge()  audio.lunge()                                         // Player.onDodge / onLunge (the dash moves, E27)
 *   audio.footstep(sprinting)  audio.jump()  audio.land(hard)  audio.hitMarker()  audio.kill()
 *   audio.splash(impact)  audio.wadeStep(depth, sprinting)  audio.swimStroke()  audio.waterExit()   // water (Player.onEnterWater / onStep while wading / onStroke / onExitWater)
 *   audio.dive()  audio.surface()  audio.setUnderwater(on)   // diving (Player.onSubmerge / onSurface): plunge + gasp, and the whole mix muffled (master lowpass) with a low hum + bubbles while under
 *   audio.animal('deer_call'|'boar_grunt'|'hoofsteps'|'boar_squeal'|'bear_growl'|'bear_roar'|'bear_hurt', position, listenerPos, yaw?)
 *   audio.footstep(sprinting, 'litter'|'planks'|'sand'|'grass'|'gravel')         // surface: pine litter (default), the pier deck, the beach, grass, a road
 *   audio.setAmbient(true|false)  audio.setAmbient(bedId)   audio.muted = true|false   audio.master.gain (0.6)
 *   audio.registerCalls(table, scope)   // a level's own creature calls (reach, gap, synth after the sampled take) — audio.animal plays them
 *   audio.installSynthBed(id, bed, scope)   // a level's synth bed for `setAmbient(id)` when no sampled bed of that id decoded
 *   audio.counts                                          // { [sound]: calls } — a debug tally (headless checks)
 *   audio.worldMuted = true|false        // sfx + ambient only (the title screen: the music plays, the frozen world is quiet)
 *   audio.world                          // the bus sfx + ambient share (a zoned ambience sends its reverb returns here)
 *   audio.hurt(strength, pan)  audio.death()   // the player takes a hit (strength = dmg / 20, pan toward the attacker) / dies — both shards (B3)
 *   audio.voices                         // the procedural one-shot bank (src/client/engine/audio/Voices.ts + gen.ts): a level's footsteps + combat layers (its voice table)
 *
 * Samples (project/archive/2026-09-23-music.md v3 row 7): `audio.useSamples(bank)` — the loading bar decoded (src/client/engine/audio/preload.ts,
 * project/archive/2026-09-23-preload-offline.md; nothing is fetched after it) the selected set's public/assets/sfx/<set>/sfx.json (Best: the better take per sound of MOSS-SoundEffect v2 and Stable Audio 3 Medium)
 * when the build ships one and decodes what it lists: ambient `beds` (the level's selected bed and
 * underwater, looped loopStart → loopEnd, replacing that synth bed), `hums` (pickup / shrine) and `oneshots` (a family →
 * variant files; each call picks one at random with ±40 cents / −1.5 dB of jitter). Every sound sfx.json does not cover
 * keeps its synth version, and the synth is the fallback for everything (no file, a failed fetch or decode, offline).
 * One-shot families are the method names, with the variant after a dash where the method takes one — see `OneShot`.
 * Switching the set (the pause menu) decodes the new one from the offline cache (every set was downloaded at the bar) while
 * the old one plays on, then swaps it in and drops the old buffers; a set's `credit` goes to src/client/engine/audio/credits.ts for the menu.
 *
 * Ambient starts on resume() and runs on its own scheduler. The level's audio profile supplies the bed id and
 * sample selection to `new Audio(profile)`. `setAmbient(id)` switches it (before or after resume()); a level's own synth bed registers with
 * `installSynthBed`.
 */

const PICKUP_EMITTER:AudioLoopEmitterRecipe={scope:'Audio',sample:'pickup',graph:'pickup',out:'sfx',level:0.11,initial:'value',connect:'sample',offset:'random',
  fadeIn:{mode:'target',seconds:0.12},fadeOut:{mode:'target',seconds:0.16},stop:{mode:'timer',after:0.7,order:[1,2,0]},disconnect:{node:'out',after:0.7}};
const PICKUP_GRAPH:AudioLoopGraph=[
  {kind:'gain',id:'trem',value:0.7},{kind:'oscillator',id:'lfo',type:'sine',frequency:5.5},{kind:'gain',id:'lg',value:0.3},
  {kind:'connect',from:'lfo',to:'lg'},{kind:'connect',from:'lg',to:'trem',param:'gain'},{kind:'start',id:'lfo'},
  {kind:'filter',id:'lp',type:'lowpass',frequency:700,q:0.7},
  {kind:'oscillator',id:'o1',type:'sine',frequency:220},{kind:'oscillator',id:'o2',type:'triangle',frequency:330},{kind:'gain',id:'g2',value:0.18},
  {kind:'connect',from:'o1',to:'lp'},{kind:'connect',from:'o2',to:'g2'},{kind:'connect',from:'g2',to:'lp'},
  {kind:'connect',from:'lp',to:'trem'},{kind:'connect',from:'trem',to:'out'},{kind:'connect',from:'out',to:'sfx'},{kind:'start',id:'o1'},{kind:'start',id:'o2'}
];

const PICKUP_GRAPHS:Readonly<Record<string,AudioLoopGraph>>={pickup:PICKUP_GRAPH};

export type ImpactKind = 'wood' | 'ground' | 'flesh';
/** the mixer's own creature calls; a level adds its own ids with `registerCalls` (any string reaches `animal`) */
export type AnimalSound = 'deer_call' | 'boar_grunt' | 'hoofsteps' | 'boar_squeal' | 'elk_bugle' | 'bear_growl' | 'bear_roar' | 'bear_hurt'
  | 'crab_click' | 'crab_snap' | 'monkey_chatter' | 'monkey_shriek' | 'sailor_groan' | 'sailor_slash' | 'coconut_hit' | 'coconut_land'   // driftwood, S4.3
  | 'king_call' | 'king_hurt';      // a boss's call: the synth falls back to the bear's growl / hurt
/** an ambient bed id: a sampled bed of that name in the set, else the synth bed a level installed for it */
export type AmbientBed = string;
/** the ground under a hoof (the level's `hoofSurfaceAt`): turf, gravel, a wooden deck */
export type HoofSurface = 'grass' | 'gravel' | 'wood';
/** a level's creature call (`registerCalls`): how far it carries and its fall-off scale (default 140 / 9), the shortest
 *  gap between two of a kind, and its synth — played after the set's sampled take of the same id unless `sampled: false` */
export interface CallVoice {
  reach?: readonly [number, number];
  gap?: number;
  sampled?: boolean;
  play: (t: number, bus: GainNode, at: { position: Vector3; dist: number }) => void;
}
/** a level's synth bed (`installSynthBed`): started when its id is the bed and no sampled bed of that id decoded */
export interface SynthBed { start: () => void; stop: () => void }
export type LoopName = string;
/** a decoded loop (a bed or a hum): the buffer, its loop points in the file, and a gain from sfx.json (default per kind) */
export interface SampleLoop { buffer: AudioBuffer; loopStart: number; loopEnd: number; gain: number }

const rnd = (a: number, b: number) => a + audioRandom() * (b - a);

interface Graph { ctx: AudioContext; master: GainNode; world: GainNode; sfx: GainNode; ambient: GainNode; shade: GainNode; shadeLp: BiquadFilterNode; muffle: BiquadFilterNode; comp: DynamicsCompressorNode; noise: AudioBuffer }

// The page's one AudioContext lives in ./unlock (E155: every resident shard has its own Audio — its buses, beds, samples — on
// this one context; iOS unlocks a context once, and a parked shard's graph is simply cut from the speakers, see `park`).

export class Audio extends PlayerVoices {
  /** Bind declared step surfaces to the real terrain/floor owners without another audio clock. */
  surfaceMap<T extends string>(recipe:AudioSurfaceRecipe,names:readonly T[],ports:AudioSurfacePorts):AudioSurfaceMap<T> {return new AudioSurfaceMap(recipe,names,ports);}

  /** Bind emitted loop/fade policy to the original audio buses, graph and optional spatial owner. */
  /** Build a declared fallback bed; registration borrows the caller's scope. */
  windBed(rows:ConstructorParameters<typeof WindGustBed>[1],scope?:Scope):WindGustBed {const bed=new WindGustBed(this,rows);if(scope!==undefined)this.installSynthBed(rows.bed,bed,scope);return bed;}

  loopEmitter(recipe:AudioLoopEmitterRecipe,graphs:Readonly<Record<string,AudioLoopGraph>>,ports:LoopEmitterPorts={}):LoopEmitter {const graph=graphs[recipe.graph];if(graph===undefined)throw new Error('Missing loop emitter graph');return new LoopEmitter(this,recipe,graph,ports);}
  private readonly scope = resourceScope().child('Audio');
  private readonly memoryOwner = resourceScope().name;
  listenerYaw = 0;
  listenerPosition: Vector3 | null = null;
  music: Music | null = null;
  private cueMap: CueMap | undefined;
  private ownBeds: readonly string[] | undefined;
  private liveBeds: (() => number) | undefined;
  private levelBank: LevelAudioBank | undefined;
  private readonly levelBankFns = new Set<(bank: LevelAudioBank) => void>();
  /** Named mixer buses preserve the existing gains while audio subsystems migrate. */
  bus(id: 'music' | 'ambience' | 'sfx' | 'voice' | 'ui'): GainNode {
    return id === 'music' ? this.master : id === 'ambience' ? this.ambient : this.sfx;
  }
  override cue(id: string, opts: CueOpts = {}): boolean { return this.cueMap?.(id, opts) ?? false; }
  installCues(map: CueMap, scope: Scope): void {
    this.cueMap = map;
    scope.onDispose(() => { if (this.cueMap === map) this.cueMap = undefined; });
  }
  installBeds(ids: readonly string[], scope: Scope, active: () => number = () => 0): void {
    this.ownBeds = ids;
    this.liveBeds = active;
    if (this.g) this.stopBed();
    scope.onDispose(() => { this.ownBeds = undefined; this.liveBeds = undefined; this.levelBank = undefined; });
  }
  get bedIds(): readonly string[] | undefined { return this.ownBeds; }
  onLevelBank(fn: (bank: LevelAudioBank) => void, scope: Scope): void {
    this.levelBankFns.add(fn);
    scope.onDispose(() => { this.levelBankFns.delete(fn); });
    if (this.levelBank) fn(this.levelBank);
  }
  useLevelBank(bank: LevelAudioBank): void {
    this.levelBank = bank;
    if (bank.samples) this.useSamples(bank.samples);
    if (bank.title) this.music?.useBank(bank.title);
    for (const fn of this.levelBankFns) fn(bank);
  }
  /** the procedural one-shot bank (gen.ts rendered to AudioBuffers after the first gesture) — a level's voice table plays it */
  override readonly voices: Voices = new Voices(this);
  voice(): Voices { return this.voices; }
  /** the WebAudio graph, built on the first gesture (resume) — creating the first AudioContext is a ~150 ms main-thread
   *  task on the phone tier, so boot never pays it; sounds asked for before then are dropped (the context could not play them) */
  private g: Graph | undefined;
  private started = false;
  /** the ambient bus is on (`setAmbient(false)` mutes it) — a level's bed schedulers read it */
  ambientOn = true;
  private _muted = false;
  private _worldMuted = false;
  private bed: AmbientBed;
  private bedNodes: AudioNode[] = [];
  private hum:LoopEmitterVoice|undefined;
  private humOn = false;
  private underwater = false; private underGain?: GainNode; private bubbleTimer: ReturnType<Scope['timeout']> = 0;
  /** the synth hum's sources under water (swapped for the underwater bed when one decodes) */
  private underFeed: AudioScheduledSourceNode[] = []; private underSample = false;
  // ── samples (sfx.json) ──
  private sfxSet: SfxSet = getSfxSet();
  private loops = new Map<LoopName, SampleLoop>();
  private shots = new Map<string, { bufs: AudioBuffer[]; gain: number }>();
  private sampleBed = false;
  census(): { activeVoices: number; beds: number; buses: number } {
    return { activeVoices: currentOwner()?.census.sounds ?? 0, beds: this.liveBeds?.() ?? (this.bedNodes.length > 0 ? 1 : 0), buses: this.g ? 8 : 0 };
  }
  unloadLevel(): void {
    this.queuedResume?.cancel(); this.queuedResume = undefined;
    this.started = false;
    this.stopBed();
    this.hum?.stop(); this.hum = undefined; this.humOn = false;
    for (const source of this.underFeed) { try { source.stop(); } catch { /* May have already ended. */ } source.disconnect(); }
    this.underFeed.length = 0;
    this.worldMuted = true;
  }

  constructor(profile: { bed?: string } = {}) {
    super();
    this.bed = profile.bed ?? '';
  }

  /** the graph, built on first use: master → muffle → compressor → out, with the sfx and ambient buses and a 2 s noise buffer */
  private graph(): Graph {
    if (this.g) return this.g;
    const ctx = claimPageAudioContext();
    if (ctx === undefined) throw new Error('WebAudio unsupported');
    const master = ctx.createGain(); master.gain.value = this._muted ? 0 : 0.6;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.16;
    const muffle = ctx.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 20000; muffle.Q.value = 0.5;
    master.connect(muffle).connect(comp);
    if (!this._parked) comp.connect(ctx.destination);
    // sfx + ambient share a `world` gain, so the title screen can hush the (frozen) world while the music plays on the master
    const world = ctx.createGain(); world.gain.value = this._worldMuted ? 0 : 1; world.connect(master);
    const sfx = ctx.createGain(); sfx.gain.value = 1; sfx.connect(world);
    const ambient = ctx.createGain(); ambient.gain.value = this.ambientOn ? 0.55 : 0;
    // the shade: the shard's bed heard through a wall (a cabin) or under night — a gain + low-pass a zoned ambience moves
    const shade = ctx.createGain(); shade.gain.value = 1;
    const shadeLp = ctx.createBiquadFilter(); shadeLp.type = 'lowpass'; shadeLp.frequency.value = 20000; shadeLp.Q.value = 0.5;
    ambient.connect(shadeLp).connect(shade).connect(world);
    const len = ctx.sampleRate * 2, noise = observeAudioMemory(ctx.createBuffer(1, len, ctx.sampleRate), { owner: this.memoryOwner, asset: 'audio/mixer/noise' }), d = noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = audioRandom() * 2 - 1;
    this.g = { ctx, master, world, sfx, ambient, shade, shadeLp, muffle, comp, noise };
    return this.g;
  }

  private _parked = false;
  /**
   * A parked shard's sound (E155): its whole graph — beds, hums, the music routed through its master — is cut from the
   * speakers (the compressor's output), whatever its gains say; `park(false)` connects it again. Nothing is rebuilt.
   */
  park(on: boolean): void {
    if (on === this._parked) return;
    this._parked = on;
    const g = this.g; if (!g) return;
    if (on) g.comp.disconnect(); else g.comp.connect(g.ctx.destination);
  }
  get parked(): boolean { return this._parked; }
  /** evicted for good: its graph is cut from the speakers and its schedulers stop (the shared context lives on for the others) */
  evict(): void {
    this.park(true);
    if (!this.g) return;
    this.stopBed();
    this.hum?.stop(); this.hum = undefined;
    this.scope.cancelTimer(this.bubbleTimer);
    this.g.master.disconnect();
  }
  override get ctx(): AudioContext { return this.graph().ctx; }
  get master(): GainNode { return this.graph().master; }
  override get sfx(): GainNode { return this.graph().sfx; }
  override get ambient(): GainNode { return this.graph().ambient; }
  /** sfx + ambient's shared bus (hushed on the title screen) — reverb returns go here */
  get world(): GainNode { return this.graph().world; }
  /** Current ambient bus shade without constructing an audio graph; scoped users can restore the borrowed mix. */
  get ambientShade(): Readonly<{ level: number; cutoff: number }> {
    return { level: this.g?.shade.gain.value ?? 1, cutoff: this.g?.shadeLp.frequency.value ?? 20000 };
  }
  /** the ambient bus as heard from inside / at night: its level (1 = untouched) and a low-pass cutoff, eased over ~300 ms.
   *  A zoned ambience muffles the shard bed inside a cabin and lowers the day bed at night. */
  shadeAmbient(level: number, cutoff = 20000): void {
    const g = this.g; if (!g) return;
    const t = g.ctx.currentTime;
    g.shade.gain.setTargetAtTime(Math.max(0, Math.min(1, level)), t, 0.1);
    g.shadeLp.frequency.setTargetAtTime(Math.max(200, Math.min(20000, cutoff)), t, 0.1);
  }
  /** the master low-pass under water: cutoff (Hz) and ramp (s); Driftwood sets 500 / 0.15 (S2), Pine Hollow keeps 520 / 0.3 */
  underwaterCutoff = 520; underwaterRamp = 0.3;
  /** the graph exists (a gesture has happened) — per-frame callers check this so they never create the context */
  override get ready(): boolean { return this.g !== undefined; }
  /** a decoded bed / hum from sfx.json, or undefined (the caller plays its synth version) */
  loop(name: LoopName): SampleLoop | undefined { return this.loops.get(name); }
  /** diagnostics: which sounds sfx.json replaced */
  get samples(): { set: SfxSet; loops: LoopName[]; oneshots: string[]; sampleBed: boolean; underSample: boolean } {
    return { set: this.sfxSet, loops: [...this.loops.keys()], oneshots: [...this.shots.keys()], sampleBed: this.sampleBed, underSample: this.underSample };
  }

  /** a decoded set — the loading bar's (src/client/engine/boot/extras.ts) or a menu switch's — replaces the synth versions (and the previous
   *  set) where they sound; before the first gesture it only fills the maps, and resume() starts the bed from them */
  useSamples(bank: SfxBank): void {
    if (bank.set !== this.sfxSet) return; // another set was picked while this one decoded
    const hadBed = this.sampleBed, hadUnder = this.underSample, hadHum = this.hum?.sample === true;
    this.loops = new Map(bank.loops); this.shots = new Map(bank.shots);
    if (bank.credit !== undefined) setSfxCredit(this.sfxSet, bank.credit);
    if (!this.g) return;
    if (this.started && (hadBed || this.loops.has(this.bed))) { this.stopBed(); this.startBed(); }
    if (this.underGain && (hadUnder || this.loops.has('underwater'))) this.feedUnder();
    if (this.hum && (hadHum || this.loops.has('pickup'))) { const h = this.hum; this.hum = undefined; h.stop(); if (this.humOn) this.pickupHum(true); }
  }
  /** a random variant of `family` with a little pitch / gain jitter, routed like the synth call; false = not sampled, play the synth */
  override shot(family: string, o: { pan?: number; gain?: number; out?: AudioNode; t?: number; rate?: number } = {}): boolean {
    const set = this.shots.get(family);
    if (!set || !this.g) return false;
    return this.voices.sample(set.bufs.map((buffer) => ({ buffer, offset: 0, duration: buffer.duration, gain: set.gain })),
      { ...o, time: o.t ?? 0 }, { jitter: 40, gainJitter: 0.84 }) !== undefined;
  }
  /** a sampled one-shot of this set exists (a zoned ambience scatters calls only when they are sampled) */
  hasShot(family: string): boolean { return this.shots.has(family); }
  /** a looping source of `l` (loopStart → loopEnd) started now, from a random point inside the loop so two plays never phase */
  private loopSource(l: SampleLoop): AudioBufferSourceNode {
    const c = this.ctx, s = ownAudioSource(c.createBufferSource());
    loopAt(s, l.buffer, l, audioRandom, c.currentTime);
    return s;
  }
  /** the master lowpass: wide open on land, shut down to ~500 Hz under water (setUnderwater) */
  private get muffle(): BiquadFilterNode { return this.graph().muffle; }
  /** the 2 s white-noise buffer every noise voice loops */
  override get noise(): AudioBuffer { return this.graph().noise; }

  /** the world's sounds (sfx + ambient) silenced while the music (on the master) plays — the title / main menu (main.ts) */
  get worldMuted(): boolean { return this._worldMuted; }
  set worldMuted(v: boolean) { this._worldMuted = v; if (this.g) this.g.world.gain.setTargetAtTime(v ? 0 : 1, this.g.ctx.currentTime, 0.08); }
  get muted(): boolean { return this._muted; }
  set muted(v: boolean) { this._muted = v; if (this.g) this.g.master.gain.setTargetAtTime(v ? 0 : 0.6, this.g.ctx.currentTime, 0.05); }

  /** a `resume()` asked for before the first gesture (G325), run by it */
  private queuedResume: { cancel: () => void } | undefined;
  /** Call from a user gesture (it builds the graph there — iOS unlocks a context made inside a gesture). Idempotent.
   *  Before the page's first gesture (G325, `installAudioUnlock`) it queues and runs inside that gesture instead. */
  resume(): void {
    if (!audioUnlocked()) {
      this.queuedResume ??= whenAudioUnlocked(() => { this.queuedResume = undefined; this.resume(); });
      return;
    }
    const built = this.g !== undefined, c = this.ctx;
    resumePageAudioContext(c);
    if (!built && this.underwater) { this.underwater = false; this.setUnderwater(true); } // dove before the first gesture
    if (!this.started) { this.started = true; this.startAmbient(); }
    if (!built) this.scope.timeout(1500, () => this.voices.prewarm(['hurt', 'death'])); // rendered in the background, before the first hit
  }

  /** `true`/`false` mutes the bed; a bed id swaps it (the default wind + birds ↔ surf + breeze + gulls ↔ a level's synth bed) */
  setAmbient(on: boolean | AmbientBed): void {
    if (typeof on === 'string') {
      if (on === this.bed) return;
      this.bed = on;
      if (this.started) { this.stopBed(); this.startBed(); }
      return;
    }
    this.ambientOn = on; if (this.g) this.g.ambient.gain.setTargetAtTime(on ? 0.55 : 0, this.g.ctx.currentTime, 0.4);
  }

  // ─────────────── building blocks ───────────────
  // ─────────────── weapon ───────────────
  pickupHum(on: boolean): void {
    tap.sound?.('pickupHum');
    this.humOn = on;
    if (!this.g) return;
    const c = this.ctx, t = c.currentTime;
    if (on) {
      this.hum??=this.loopEmitter(PICKUP_EMITTER,PICKUP_GRAPHS,{scope:this.scope}).start(t);
      this.hum.fadeIn(t);
    } else if (this.hum) {
      const voice=this.hum;this.hum=undefined;voice.fadeOut(t);
    }
  }

  // ─────────────── movement ───────────────
  setUnderwater(on: boolean): void {
    if (on === this.underwater) return;
    this.underwater = on;
    if (!this.g) return; // resume() applies it
    const c = this.ctx, t = c.currentTime;
    this.muffle.frequency.cancelScheduledValues(t);
    this.muffle.frequency.setValueAtTime(this.muffle.frequency.value, t);
    this.muffle.frequency.exponentialRampToValueAtTime(on ? this.underwaterCutoff : 20000, t + this.underwaterRamp);
    if (!this.underGain) {
      // the hum: brown-ish noise through a 90 Hz lowpass, swelling on a slow LFO; lives on the ambient bus (mutes with it)
      this.underGain = c.createGain(); this.underGain.gain.value = 0; this.underGain.connect(this.ambient);
      this.feedUnder();
    }
    this.underGain.gain.cancelScheduledValues(t);
    this.underGain.gain.setValueAtTime(this.underGain.gain.value, t);
    this.underGain.gain.linearRampToValueAtTime(on ? 1.4 : 0, t + (on ? 0.6 : 0.3));
    this.scope.cancelTimer(this.bubbleTimer);
    if (on) this.scheduleBubble();
  }

  /** what feeds the underwater gain: the set's underwater bed when one decoded, else the synth hum (re-run when either changes;
   *  the envelope in setUnderwater is untouched) */
  private feedUnder(): void {
    tap.sound?.('audio.feedUnder');
    const g = this.underGain;
    if (!g) return;
    const c = this.ctx, l = this.loops.get('underwater');
    for (const n of this.underFeed) { try { n.stop(); } catch { /* not started */ } }
    if (l) {
      const lvl = c.createGain(); lvl.gain.value = l.gain / 1.4; // the synth hum's envelope peaks at 1.4
      const s = this.loopSource(l); s.connect(lvl).connect(g);
      this.underFeed = [s]; this.underSample = true;
      return;
    }
    const src = ownAudioSource(c.createBufferSource()); src.buffer = this.noise; src.loop = true; src.start(0, audioRandom());
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 90; lp.Q.value = 0.9;
    const lp2 = c.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 220;
    const lfo = ownAudioSource(c.createOscillator()); lfo.frequency.value = 0.13; const lg = c.createGain(); lg.gain.value = 0.35;
    const sw = c.createGain(); sw.gain.value = 1; lfo.connect(lg).connect(sw.gain); lfo.start();
    src.connect(lp).connect(lp2).connect(sw).connect(g);
    this.underFeed = [src, lfo]; this.underSample = false;
  }

  private scheduleBubble() {
    this.bubbleTimer = this.scope.timeout(rnd(1.2, 4.5) * 1000, () => {
      ambientTick('audio.bubble', () => {
        if (!this.underwater) return;
        const t = this.ctx.currentTime, n = 1 + Math.floor(rnd(0, 4)), pan = rnd(-0.7, 0.7);
        for (let i = 0; i < n; i++) this.tone({ t: t + i * rnd(0.05, 0.12), type: 'sine', f0: rnd(300, 700), f1: rnd(800, 1600), glide: 0.07, gain: rnd(0.015, 0.04), attack: 0.004, decay: rnd(0.04, 0.08), pan, out: this.ambient });
        this.scheduleBubble();
      });
    });
  }

  // ─────────────── feedback ───────────────
  animal(kind: AnimalSound | (string & Record<never, never>), position: Vector3, listenerPos: Vector3, yaw: number = this.listenerYaw): void {
    tap.sound?.(`animal:${kind}`);
    if (!this.g) return;
    const own = this.calls.get(kind);
    const [reach, scale] = own?.reach ?? [140, 9];
    const spatial = spatialAudio(position, listenerPos, yaw, reach, scale);
    if (spatial === null) return;
    const { dist, gain: att, pan } = spatial;
    const gap = own?.gap;
    if (gap !== undefined) {
      const now = this.ctx.currentTime;
      if (now - (this.lastCall[kind] ?? -1e9) < gap) return;
      this.lastCall[kind] = now;
    }
    this.tally(kind);
    // distance low-pass into a per-call bus
    const bus = this.ctx.createGain(); bus.gain.value = att;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 9000 / (1 + dist / 25);
    bus.connect(lp); this.route(lp, pan);
    // a level's own call can skip the set's sample of its id (hooves that sample per ground)
    if (own?.sampled !== false && this.shot(kind, { out: bus })) return;
    const t = this.ctx.currentTime;
    if (own) { own.play(t, bus, { position, dist }); return; }
    switch (kind) {
      case 'deer_call': { // bleat: FM-ish sawtooth with a rising-falling contour
        const dur = rnd(0.35, 0.55);
        this.tone({ t, type: 'sawtooth', f0: 560, f1: 780, glide: dur * 0.4, gain: 0.5, attack: 0.05, hold: dur * 0.4, decay: dur * 0.5, vibrato: { rate: 26, depth: 45 }, lowpass: 2200, out: bus });
        this.tone({ t: t + dur * 0.4, type: 'sawtooth', f0: 780, f1: 520, glide: dur * 0.6, gain: 0.3, attack: 0.02, decay: dur * 0.6, vibrato: { rate: 26, depth: 45 }, lowpass: 1800, out: bus });
        this.burst({ t, type: 'bandpass', freq: 1400, q: 0.6, gain: 0.12, attack: 0.05, hold: dur * 0.5, decay: dur * 0.5, out: bus });
        break;
      }
      case 'boar_grunt': {
        const n = 1 + Math.floor(rnd(0, 2.5));
        for (let i = 0; i < n; i++) {
          const ti = t + i * rnd(0.22, 0.32);
          this.tone({ t: ti, type: 'sawtooth', f0: rnd(80, 100), f1: 62, glide: 0.2, gain: 0.7, attack: 0.03, hold: 0.06, decay: 0.16, vibrato: { rate: 13, depth: 9 }, lowpass: 520, out: bus });
          this.burst({ t: ti, type: 'lowpass', freq: 420, gain: 0.5, attack: 0.02, hold: 0.05, decay: 0.15, out: bus });
        }
        break;
      }
      case 'hoofsteps': {
        for (let i = 0; i < 4; i++) {
          const ti = t + i * rnd(0.11, 0.16);
          this.burst({ t: ti, type: 'lowpass', freq: rnd(260, 360), gain: 0.45, decay: 0.06, out: bus });
          this.tone({ t: ti, type: 'sine', f0: rnd(62, 80), f1: 40, glide: 0.04, gain: 0.35, decay: 0.07, out: bus });
        }
        break;
      }
      case 'boar_squeal': {
        this.tone({ t, type: 'sawtooth', f0: 900, f1: 1500, glide: 0.12, gain: 0.8, attack: 0.02, hold: 0.15, decay: 0.3, vibrato: { rate: 32, depth: 70 }, lowpass: 3500, out: bus });
        this.tone({ t: t + 0.12, type: 'sawtooth', f0: 1500, f1: 700, glide: 0.4, gain: 0.5, attack: 0.01, decay: 0.4, vibrato: { rate: 32, depth: 70 }, lowpass: 3000, out: bus });
        this.burst({ t, type: 'bandpass', freq: 2200, q: 0.7, gain: 0.25, attack: 0.02, hold: 0.2, decay: 0.3, out: bus });
        break;
      }
      case 'elk_bugle': { // bull elk bugle (~1.5 s): a breathy whistle climbing an octave and a half, holding, then dropping into a chesty bellow + grunts
        const rise = rnd(0.45, 0.6), hold = rnd(0.35, 0.5), fall = rnd(0.3, 0.45);
        const top = rnd(1350, 1650);
        // the whistle: a near-sine with a faint harmonic, slow wide vibrato once it reaches the top
        this.tone({ t, type: 'sine', f0: top * 0.42, f1: top, glide: rise, gain: 0.55, attack: 0.08, hold: rise + hold - 0.08, decay: 0.06, vibrato: { rate: 5.5, depth: 28 }, out: bus });
        this.tone({ t, type: 'triangle', f0: top * 0.42, f1: top, glide: rise, gain: 0.16, attack: 0.08, hold: rise + hold - 0.08, decay: 0.06, vibrato: { rate: 5.5, depth: 28 }, lowpass: 4200, out: bus });
        // breath around the whistle
        this.burst({ t, type: 'bandpass', freq: top * 0.6, freqEnd: top * 1.1, q: 2.5, gain: 0.14, attack: 0.1, hold: rise + hold - 0.1, decay: 0.1, out: bus });
        // the drop: the whistle breaks into a rasping bellow that slides down into the chest
        const tb = t + rise + hold;
        this.tone({ t: tb, type: 'sawtooth', f0: top * 0.55, f1: 180, glide: fall, gain: 0.5, attack: 0.02, hold: 0.05, decay: fall, vibrato: { rate: 18, depth: 40 }, lowpass: 2600, out: bus });
        this.tone({ t: tb + 0.04, type: 'sawtooth', f0: 320, f1: 110, glide: fall, gain: 0.45, attack: 0.03, decay: fall + 0.1, vibrato: { rate: 12, depth: 14 }, lowpass: 900, out: bus });
        this.burst({ t: tb, type: 'bandpass', freq: 1400, freqEnd: 400, q: 0.8, gain: 0.22, attack: 0.02, decay: fall, out: bus });
        // two or three chuckle-grunts on the tail
        const n = 2 + Math.floor(rnd(0, 1.9));
        for (let i = 0; i < n; i++) {
          const ti = tb + fall + 0.05 + i * rnd(0.14, 0.2);
          this.tone({ t: ti, type: 'sawtooth', f0: rnd(120, 150), f1: 85, glide: 0.1, gain: 0.4, attack: 0.015, hold: 0.03, decay: 0.09, lowpass: 700, out: bus });
          this.burst({ t: ti, type: 'lowpass', freq: 500, gain: 0.3, attack: 0.01, hold: 0.02, decay: 0.08, out: bus });
        }
        break;
      }
      case 'king_call': // the Golden King's groan when no sample decoded: the bear's growl (its old voice)
      case 'bear_growl': { // low chesty huff-growl: a slow sawtooth rumble under a breathy lowpass exhale, one or two huffs
        const n = 1 + Math.floor(rnd(0, 1.8));
        for (let i = 0; i < n; i++) {
          const ti = t + i * rnd(0.45, 0.65), dur = rnd(0.5, 0.8);
          this.tone({ t: ti, type: 'sawtooth', f0: rnd(48, 58), f1: 40, glide: dur, gain: 0.85, attack: 0.08, hold: dur * 0.45, decay: dur * 0.55, vibrato: { rate: 9, depth: 5 }, lowpass: 260, out: bus });
          this.tone({ t: ti + 0.02, type: 'square', f0: rnd(70, 84), f1: 58, glide: dur, gain: 0.25, attack: 0.1, hold: dur * 0.4, decay: dur * 0.5, vibrato: { rate: 11, depth: 8 }, lowpass: 380, out: bus });
          this.burst({ t: ti, type: 'lowpass', freq: 520, gain: 0.55, attack: 0.05, hold: dur * 0.35, decay: dur * 0.6, out: bus });
        }
        break;
      }
      case 'bear_roar': { // the charge: a rising bellow — two detuned sawtooths sweeping up then tearing off, with a breath-noise rasp
        const dur = rnd(0.9, 1.2);
        this.tone({ t, type: 'sawtooth', f0: 70, f1: 150, glide: dur * 0.45, gain: 1.0, attack: 0.05, hold: dur * 0.5, decay: dur * 0.5, vibrato: { rate: 14, depth: 14 }, lowpass: 900, out: bus });
        this.tone({ t: t + 0.03, type: 'sawtooth', f0: 104, f1: 226, glide: dur * 0.45, gain: 0.55, attack: 0.06, hold: dur * 0.5, decay: dur * 0.5, vibrato: { rate: 14, depth: 20 }, lowpass: 1400, out: bus });
        this.tone({ t: t + dur * 0.5, type: 'sawtooth', f0: 150, f1: 90, glide: dur * 0.5, gain: 0.5, attack: 0.01, decay: dur * 0.55, vibrato: { rate: 18, depth: 18 }, lowpass: 700, out: bus });
        this.burst({ t, type: 'bandpass', freq: 700, q: 0.5, gain: 0.5, attack: 0.05, hold: dur * 0.55, decay: dur * 0.5, out: bus });
        this.burst({ t: t + 0.05, type: 'lowpass', freq: 1600, gain: 0.3, attack: 0.1, hold: dur * 0.4, decay: dur * 0.5, out: bus });
        break;
      }
      // ── Driftwood Isle enemies (species/{crab,monkey,sailor}.ts + Enemies.ts) ──
      case 'crab_click': { // the reef crab: two to four dry clicks of the mouthparts
        const n = 2 + Math.floor(rnd(0, 2.9));
        for (let i = 0; i < n; i++) { const ti = t + i * rnd(0.06, 0.1); this.burst({ t: ti, type: 'bandpass', freq: rnd(2200, 3200), q: 5, gain: 0.55, decay: 0.03, out: bus }); this.tone({ t: ti, type: 'square', f0: 1800, f1: 900, glide: 0.02, gain: 0.12, decay: 0.025, out: bus }); }
        break;
      }
      case 'crab_snap': { // the pincer shutting: a hard crack with a knock under it
        this.burst({ t, type: 'highpass', freq: 1800, gain: 0.9, decay: 0.05, out: bus });
        this.burst({ t: t + 0.005, type: 'bandpass', freq: 900, q: 2, gain: 0.6, decay: 0.08, out: bus });
        this.tone({ t, type: 'sine', f0: 140, f1: 70, glide: 0.06, gain: 0.5, decay: 0.09, out: bus });
        break;
      }
      case 'monkey_chatter': { // three to five quick "ook-ook" chirps
        const n = 3 + Math.floor(rnd(0, 2.9)), base = rnd(520, 720);
        for (let i = 0; i < n; i++) { const ti = t + i * rnd(0.09, 0.14); this.tone({ t: ti, type: 'sawtooth', f0: base, f1: base * 1.5, glide: 0.05, gain: 0.45, attack: 0.01, hold: 0.03, decay: 0.06, vibrato: { rate: 30, depth: 40 }, lowpass: 2600, out: bus }); this.burst({ t: ti, type: 'bandpass', freq: base * 2.2, q: 1.5, gain: 0.12, decay: 0.06, out: bus }); }
        break;
      }
      case 'monkey_shriek': { // a rising screech that breaks up
        this.tone({ t, type: 'sawtooth', f0: 800, f1: 1900, glide: 0.18, gain: 0.7, attack: 0.01, hold: 0.12, decay: 0.22, vibrato: { rate: 38, depth: 120 }, lowpass: 4200, out: bus });
        this.tone({ t: t + 0.05, type: 'square', f0: 1200, f1: 2400, glide: 0.2, gain: 0.2, attack: 0.01, decay: 0.3, vibrato: { rate: 44, depth: 200 }, lowpass: 3800, out: bus });
        this.burst({ t, type: 'bandpass', freq: 2600, q: 0.8, gain: 0.25, attack: 0.02, hold: 0.15, decay: 0.2, out: bus });
        break;
      }
      case 'sailor_groan': { // a drowned groan: a long low rasp under a watery gurgle
        const dur = rnd(0.9, 1.4);
        this.tone({ t, type: 'sawtooth', f0: rnd(78, 92), f1: 58, glide: dur, gain: 0.8, attack: 0.15, hold: dur * 0.4, decay: dur * 0.5, vibrato: { rate: 6, depth: 6 }, lowpass: 420, out: bus });
        this.tone({ t: t + 0.05, type: 'square', f0: 120, f1: 84, glide: dur, gain: 0.18, attack: 0.2, hold: dur * 0.35, decay: dur * 0.5, vibrato: { rate: 9, depth: 10 }, lowpass: 600, out: bus });
        this.burst({ t, type: 'bandpass', freq: 520, freqEnd: 240, q: 3, gain: 0.35, attack: 0.1, hold: dur * 0.5, decay: dur * 0.5, rate: 0.6, out: bus });
        for (let i = 0; i < 5; i++) this.burst({ t: t + rnd(0.1, dur), type: 'bandpass', freq: rnd(300, 700), q: 6, gain: 0.25, decay: 0.05, out: bus });   // bubbles
        break;
      }
      case 'sailor_slash': { // the cutlass: a rising whoosh
        this.burst({ t, type: 'bandpass', freq: 700, freqEnd: 2600, q: 1.2, gain: 0.6, attack: 0.03, hold: 0.06, decay: 0.16, out: bus });
        this.burst({ t: t + 0.02, type: 'highpass', freq: 3000, gain: 0.2, attack: 0.04, decay: 0.14, out: bus });
        break;
      }
      case 'coconut_hit': { // a coconut off your skull: a hard hollow knock
        this.tone({ t, type: 'sine', f0: 260, f1: 120, glide: 0.05, gain: 0.8, decay: 0.12, out: bus });
        this.burst({ t, type: 'lowpass', freq: 900, gain: 0.5, decay: 0.05, out: bus });
        break;
      }
      case 'coconut_land': { // a coconut in the sand: a dull thump and a hiss of grains
        this.tone({ t, type: 'sine', f0: 150, f1: 70, glide: 0.06, gain: 0.55, decay: 0.12, out: bus });
        this.burst({ t: t + 0.01, type: 'lowpass', freq: 1400, gain: 0.3, attack: 0.01, decay: 0.12, out: bus });
        break;
      }
      case 'king_hurt': // the King struck, unsampled: the bear's bark-roar
      case 'bear_hurt': { // a hit: a sharp bark-roar, higher and shorter than the charge bellow, dropping into a grunt
        this.tone({ t, type: 'sawtooth', f0: 220, f1: 330, glide: 0.08, gain: 0.9, attack: 0.01, hold: 0.12, decay: 0.28, vibrato: { rate: 22, depth: 30 }, lowpass: 1800, out: bus });
        this.tone({ t: t + 0.05, type: 'sawtooth', f0: 330, f1: 120, glide: 0.35, gain: 0.6, attack: 0.01, decay: 0.4, vibrato: { rate: 16, depth: 20 }, lowpass: 1000, out: bus });
        this.tone({ t: t + 0.32, type: 'sawtooth', f0: 64, f1: 46, glide: 0.25, gain: 0.5, attack: 0.03, hold: 0.1, decay: 0.25, lowpass: 320, out: bus });
        this.burst({ t, type: 'bandpass', freq: 1100, q: 0.6, gain: 0.4, attack: 0.01, hold: 0.15, decay: 0.3, out: bus });
        break;
      }
      default: break; // an unknown id with no registered call: silent
    }
  }

  /** the ground under the player's feet a level reports for its hooves (main's footsteps read it); unset = the shard's own */
  hoofSurfaceAt?: ((x: number, z: number) => HoofSurface) | undefined;
  /** calls per sound name since boot (a debug tally: headless checks read `audio.counts`) */
  readonly counts: Record<string, number> = {};
  private readonly lastCall: Partial<Record<string, number>> = {};
  tally(name: string): void { this.counts[name] = (this.counts[name] ?? 0) + 1; }

  // ─────────────── a level's own voices ───────────────
  private readonly calls = new Map<string, CallVoice>();
  /** a level's creature calls for `animal()`, for the life of `scope` */
  registerCalls(table: Readonly<Record<string, CallVoice>>, scope: Scope): void {
    for (const [id, voice] of Object.entries(table)) this.calls.set(id, voice);
    scope.onDispose(() => { for (const [id, voice] of Object.entries(table)) if (this.calls.get(id) === voice) this.calls.delete(id); });
  }
  private readonly synthBeds = new Map<string, SynthBed>();
  /** a level's synth bed for `setAmbient(id)`, for the life of `scope` (started now if it is the bed already playing) */
  installSynthBed(id: string, bed: SynthBed, scope: Scope): void {
    this.synthBeds.set(id, bed);
    scope.onDispose(() => { if (this.synthBeds.get(id) === bed) { this.synthBeds.delete(id); bed.stop(); } });
  }
  /** the current bed id (`setAmbient`) */
  get bedId(): string { return this.bed; }
  /** restart the bed when `id` is the synth bed playing (a level's bed changed what it plays) */
  restartSynthBed(id: string): void { if (this.started && this.bed === id && !this.sampleBed) { this.stopBed(); this.startBed(); } }
  /** nodes of a level's synth bed: faded and stopped with the bed */
  ownBedNodes(...nodes: AudioNode[]): void { this.bedNodes.push(...nodes); }

  // ─────────────── ambient loop ───────────────
  private startAmbient() { this.startBed(); }

  private stopBed() {
    this.synthBeds.get(this.bed)?.stop();
    if (this.bedNodes.length === 0) return; // nothing sounding (and before the first gesture, no context to ask the time)
    const t = this.ctx.currentTime;
    for (const n of this.bedNodes) {
      if (n instanceof GainNode) { n.gain.cancelScheduledValues(t); n.gain.setTargetAtTime(0, t, 0.6); }
      if (n instanceof AudioScheduledSourceNode) n.stop(t + 3);
    }
    this.bedNodes = [];
  }

  private startBed() {
    if (this.ownBeds) return;
    const l = this.loops.get(this.bed);
    this.sampleBed = l !== undefined;
    const own = this.synthBeds.get(this.bed);
    if (l) this.startSampleBed(l);
    else if (own) own.start();
  }
  /** sfx.json's bed for this shard: one looping source faded in over 2 s (replaces the synth winds, birds, gusts and surf) */
  private startSampleBed(l: SampleLoop) {
    tap.sound?.('audio.startSampleBed');
    const c = this.ctx, t = c.currentTime, g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(l.gain, t + 2);
    const s = this.loopSource(l); s.connect(g).connect(this.ambient);
    this.bedNodes.push(g, s);
  }

  /** a looping noise band: bandpass + lowpass, slow amplitude and filter LFOs, panned into the ambient bus */
  mkWind(freq: number, q: number, pan: number, lfoRate: number, base: number, lowpass = 1200): GainNode {
    const graph = this.createSynthBeds(new AmbienceZones(this, audioRandom), audioRandom);
    const made = graph.assemble({ beds:[{id:'wind',out:'ambient',gain:base,pan,
      lfos:[{rate:lfoRate,depth:base*0.6}]}], chains:[{noise:'native-white',
      filters:[['bandpass',freq,q],['lowpass',lowpass,1]],
      sweeps:[[0,{rate:lfoRate*0.7+0.01,depth:freq*0.35}]],to:'wind'}] }, {ambient:this.ambient});
    const gain = made.beds.get('wind');
    if (!gain) throw new Error('Missing wind graph gain');
    this.bedNodes.push(gain,...graph.sources);
    return gain;
  }

  /** Lazy declared synthesis; no context or procedural bank is read until a graph is built. */
  createSynthBeds(zones: AmbienceZones, random: () => number): SynthBeds { return new SynthBeds(this,zones,random); }

  dispose(): void { this.queuedResume?.cancel(); this.queuedResume = undefined; for (const bed of this.synthBeds.values()) bed.stop(); this.scope.cancelTimer(this.bubbleTimer); if (this.g) { releasePageAudioContext(this.g.ctx); void this.g.ctx.close(); } }
}

export { Audio as GameAudio };
