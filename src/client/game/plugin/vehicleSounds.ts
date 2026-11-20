import type { AudioData } from '@wildshard/format/audio';
import type { VehicleKind } from '@wildshard/format/vehicles';
import { app } from '@wildshard/engine/app/runtime';
import type { Audio } from '@wildshard/engine/audio/Audio';
import { audioLog } from '@wildshard/engine/audio/audioLog';
import { ownAudioSource } from '@wildshard/engine/audio/ownership';
import { audioRandom, spatialAudio } from '@wildshard/engine/audio/util';
import { ownedArray } from '@wildshard/engine/core/ownedBuffer';

/**
 * MIRROR-SALT-ZONE MSZ15: what a vehicle sounds like on a page. Each vehicle the page follows has an engine loop whose rate
 * and level follow its speed and the driver's throttle; a skid that starts when it slides across its heading and stops when
 * the slide ends; an impact one-shot for each hit, louder and lower the harder it was; and the horn while its driver holds it.
 * The vehicle the page's player rides also has the wind rushing past past `VEHICLE_SOUND.windOn` m/s.
 *
 * A kind's `sounds` rows name `audio.cues` ids; each cue's voice is a declared recording (`audio.recordings`, read through the
 * page's audio reader and decoded on its context), or one of the engine's material `impact-*` voices (`Voices.ts`). A slot a
 * kind leaves out plays the engine's own synth (and `impact-wood` for a hit), so a vehicle is never silent. A sail declares
 * its luff as its `loop` and its creak as its `skid`.
 *
 * Every start, stop and hit lands in the page's audio trigger log (`window.__audioLog`, `__audioTally`): the headless report
 * a proof reads (`vehicle.loop`, `vehicle.skid`, `vehicle.skid.end`, `vehicle.impact`, `vehicle.horn`, `vehicle.wind` ...).
 *
 *   const sounds = new VehicleSounds(audioVehicleOut(audio, read), kind => vehicleSoundSources(kind, shardfile.audio));
 *   sounds.frame(dt, hearings, feet);   // once a drawn frame, every vehicle the page has out
 */
export const VEHICLE_SOUND = {
  /** m/s of slide across the heading a skid starts at, and the slide it ends under */
  skidOn: 2, skidOff: 1.2,
  /** m/s along its heading a vehicle must move for a slide to skid */
  skidSpeed: 2,
  /** m/s past which the wind rushes past a rider (the plan row's 20), and the speed it dies away under */
  windOn: 20, windOff: 18,
  /** closing speeds (m/s) under this make no impact sound (a lean against a wall is not a hit) */
  impactFrom: 1.5,
  /** s after a hit before the same vehicle sounds another: a bounce's steps are one hit */
  impactGap: 0.25,
  /** m past which another page's vehicle is not heard, and the distance its level halves near */
  reach: 90, scale: 10,
} as const;

export type VehicleSoundSlot = 'loop' | 'skid' | 'impact' | 'horn';
/** The engine's own sounds, for a slot a kind leaves out and the wind. */
export type VehicleSynth = 'loop' | 'skid' | 'horn' | 'wind';
/** What one slot plays: a declared recording, an engine voice family (the material `impact-*` voices) or the engine's synth. */
export type VehicleSoundSource =
  | { readonly kind: 'sample'; readonly path: string; readonly synth: VehicleSynth }
  | { readonly kind: 'voice'; readonly family: string }
  | { readonly kind: 'synth'; readonly synth: VehicleSynth };
export type VehicleSoundSources = Readonly<Record<VehicleSoundSlot, VehicleSoundSource>>;

const IMPACT_VOICE = /^impact-[a-z]+$/u;
const SYNTH_OWNER = { owner: 'game/vehicle-sounds', kind: 'audio-data' } as const;
const DEFAULT_IMPACT = 'impact-wood';

/** A kind's four slots, resolved through its `sounds` rows and the shard's `audio.cues` (MSZ15). */
export function vehicleSoundSources(kind: Pick<VehicleKind, 'sounds'>, audio: Pick<AudioData, 'cues' | 'recordings'>): VehicleSoundSources {
  const of = (slot: VehicleSoundSlot): VehicleSoundSource => {
    const cue = kind.sounds?.[slot], voice = cue === undefined ? undefined : audio.cues.find(row => row.id === cue)?.voice;
    const synth: VehicleSynth = slot === 'impact' ? 'skid' : slot;
    if (voice !== undefined && audio.recordings?.[voice] !== undefined) return { kind: 'sample', path: voice, synth };
    if (voice !== undefined && IMPACT_VOICE.test(voice)) return { kind: 'voice', family: voice };
    return slot === 'impact' ? { kind: 'voice', family: DEFAULT_IMPACT } : { kind: 'synth', synth };
  };
  return { loop: of('loop'), skid: of('skid'), impact: of('impact'), horn: of('horn') };
}

/** One vehicle as a frame hears it. `forward` and `slip` are m/s along and across its heading. */
export interface VehicleHearing {
  readonly id: string;
  readonly kind: Pick<VehicleKind, 'id' | 'sounds'> & { readonly handling: { readonly speed: number } };
  readonly at: { readonly x: number; readonly y: number; readonly z: number };
  readonly forward: number; readonly slip: number;
  /** The driver's throttle, 0 to 1, when this page knows it (its own driving); 0 otherwise. */
  readonly throttle: number;
  /** The hardest hit since the last frame (closing speed, m/s); 0 for none. */
  readonly impact: number;
  readonly horn: boolean;
  /** This page's player rides it: heard from the seat, with the wind past its ears. */
  readonly aboard: boolean;
}
/** A looping voice: its rate, level and pan follow each `set`; `stop` fades it out. */
export interface VehicleVoice { readonly set: (rate: number, gain: number, pan: number) => void; readonly stop: () => void }
/** Where the sounds go: a page's mixer (`audioVehicleOut`), or a test's. */
export interface VehicleSoundOut {
  /** A looping voice of `source`, silent until set; null while it cannot sound yet (before the first gesture, or decoding). */
  readonly loop: (source: VehicleSoundSource) => VehicleVoice | null;
  /** One shot of `source`; whether it sounded. */
  readonly shot: (source: VehicleSoundSource, rate: number, gain: number, pan: number) => boolean;
  /** Start reading and decoding a kind's recordings, so its first skid or hit has them. */
  readonly prepare?: (sources: VehicleSoundSources) => void;
  /** The heading the page listens along (its player's yaw): another vehicle pans by it. */
  readonly listenerYaw: () => number;
}
/** What a proof reads of one vehicle's sound now. */
export interface VehicleSoundState { readonly loopRate: number; readonly loopGain: number; readonly skidding: boolean; readonly rushing: boolean; readonly horn: boolean; readonly impacts: number }

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
/** The engine loop's rate: an idle note, rising with speed and a little more under throttle. */
export const vehicleLoopRate = (speed: number, top: number, throttle: number): number => 0.7 + clamp01(speed / Math.max(1, top)) + 0.2 * clamp01(throttle);
/** The engine loop's level before distance: an idle murmur, louder with speed and throttle. */
export const vehicleLoopGain = (speed: number, top: number, throttle: number): number => 0.5 * (0.35 + 0.4 * clamp01(speed / Math.max(1, top)) + 0.25 * clamp01(throttle));

/** A source as the trigger log names it. */
const describe = (source: VehicleSoundSource): string => (source.kind === 'sample' ? source.path : source.kind === 'voice' ? source.family : `synth:${source.synth}`);

interface Heard {
  readonly sources: VehicleSoundSources;
  loop: VehicleVoice | null; skid: VehicleVoice | null; horn: VehicleVoice | null; wind: VehicleVoice | null;
  skidding: boolean; rushing: boolean; honking: boolean; quiet: number; waited: boolean;
  loopRate: number; loopGain: number; impacts: number;
}

/** MSZ15: the sounds of the vehicles one page follows. */
export class VehicleSounds {
  private readonly heard = new Map<string, Heard>();
  private readonly out: VehicleSoundOut;
  private readonly sourcesOf: (kind: VehicleHearing['kind']) => VehicleSoundSources;
  constructor(out: VehicleSoundOut, sources: (kind: VehicleHearing['kind']) => VehicleSoundSources) { this.out = out; this.sourcesOf = sources; }

  /** One drawn frame of `dt` s: every vehicle the page has out, heard from `ear` (the player's feet). One no longer among
   *  them goes quiet. */
  frame(dt: number, vehicles: Iterable<VehicleHearing>, ear: { readonly x: number; readonly z: number }): void {
    const seen = new Set<string>(), yaw = this.out.listenerYaw();
    for (const vehicle of vehicles) {
      seen.add(vehicle.id);
      let heard = this.heard.get(vehicle.id);
      if (heard === undefined) {
        heard = { sources: this.sourcesOf(vehicle.kind), loop: null, skid: null, horn: null, wind: null, skidding: false, rushing: false, honking: false, quiet: 0, waited: false, loopRate: 0, loopGain: 0, impacts: 0 };
        this.heard.set(vehicle.id, heard);
      }
      // a rider hears it from the seat; anyone else from where it is
      let near = 1, pan = 0;
      if (!vehicle.aboard) {
        const spatial = spatialAudio(vehicle.at, { x: ear.x, y: vehicle.at.y, z: ear.z }, yaw, VEHICLE_SOUND.reach, VEHICLE_SOUND.scale);
        near = spatial?.gain ?? 0; pan = spatial?.pan ?? 0;
      }
      this.hear(vehicle, heard, near, pan, dt);
    }
    for (const [id, heard] of this.heard) if (!seen.has(id)) { this.hush(id, heard); this.heard.delete(id); }
  }
  /** What a proof reads of a vehicle's sound now; none for one not heard. */
  state(id: string): VehicleSoundState | undefined {
    const heard = this.heard.get(id);
    return heard === undefined ? undefined : { loopRate: heard.loopRate, loopGain: heard.loopGain, skidding: heard.skidding, rushing: heard.rushing, horn: heard.honking, impacts: heard.impacts };
  }
  /** Every vehicle quiet, as the page's vehicles go. */
  dispose(): void { for (const [id, heard] of this.heard) this.hush(id, heard); this.heard.clear(); }

  private hear(vehicle: VehicleHearing, heard: Heard, near: number, pan: number, dt: number): void {
    this.out.prepare?.(heard.sources);
    const { sources } = heard, speed = Math.abs(vehicle.forward), slip = Math.abs(vehicle.slip), top = vehicle.kind.handling.speed, tag = `${vehicle.kind.id} ${vehicle.id}`;
    // the engine loop, for as long as it is out
    heard.loopRate = vehicleLoopRate(speed, top, vehicle.throttle); heard.loopGain = vehicleLoopGain(speed, top, vehicle.throttle) * near;
    if (heard.loop === null) {
      heard.loop = this.out.loop(sources.loop);
      if (heard.loop !== null) audioLog('sfx', 'vehicle.loop', true, `${tag} ${describe(sources.loop)}`);
      else if (!heard.waited) { heard.waited = true; audioLog('sfx', 'vehicle.loop', false, `${tag} not ready`); }
    }
    heard.loop?.set(heard.loopRate, heard.loopGain, pan);
    // a skid while it slides across its heading
    const skidding = heard.skidding ? slip > VEHICLE_SOUND.skidOff && speed > VEHICLE_SOUND.skidSpeed / 2 : slip >= VEHICLE_SOUND.skidOn && speed >= VEHICLE_SOUND.skidSpeed;
    if (skidding !== heard.skidding) {
      heard.skidding = skidding;
      if (skidding) { heard.skid = this.out.loop(sources.skid); audioLog('sfx', 'vehicle.skid', heard.skid !== null, `${tag} ${slip.toFixed(1)} m/s`); }
      else { heard.skid?.stop(); heard.skid = null; audioLog('sfx', 'vehicle.skid.end', true, tag); }
    }
    if (heard.skidding && heard.skid === null) heard.skid = this.out.loop(sources.skid);
    heard.skid?.set(0.85 + 0.3 * clamp01(slip / 8), (0.3 + 0.7 * clamp01((slip - 1) / 6)) * 0.6 * near, pan);
    // the wind past the rider's ears, fast
    const rushing = vehicle.aboard && (heard.rushing ? speed > VEHICLE_SOUND.windOff : speed >= VEHICLE_SOUND.windOn);
    if (rushing !== heard.rushing) {
      heard.rushing = rushing;
      if (rushing) { heard.wind = this.out.loop({ kind: 'synth', synth: 'wind' }); audioLog('sfx', 'vehicle.wind', heard.wind !== null, `${tag} ${speed.toFixed(1)} m/s`); }
      else { heard.wind?.stop(); heard.wind = null; audioLog('sfx', 'vehicle.wind.end', true, tag); }
    }
    if (heard.rushing && heard.wind === null) heard.wind = this.out.loop({ kind: 'synth', synth: 'wind' });
    heard.wind?.set(0.8 + 0.5 * clamp01((speed - VEHICLE_SOUND.windOn) / 20), 0.15 + 0.45 * clamp01((speed - VEHICLE_SOUND.windOff) / 14), 0);
    // the horn while it is held
    if (vehicle.horn !== heard.honking) {
      heard.honking = vehicle.horn;
      if (vehicle.horn) { heard.horn = this.out.loop(sources.horn); audioLog('sfx', 'vehicle.horn', heard.horn !== null, tag); }
      else { heard.horn?.stop(); heard.horn = null; }
    }
    if (heard.honking && heard.horn === null) heard.horn = this.out.loop(sources.horn);
    heard.horn?.set(1, 0.7 * near, pan);
    // one impact a hit, louder and lower the harder it was
    heard.quiet = Math.max(0, heard.quiet - dt);
    if (vehicle.impact >= VEHICLE_SOUND.impactFrom && heard.quiet === 0) {
      heard.quiet = VEHICLE_SOUND.impactGap; heard.impacts++;
      const hard = clamp01(vehicle.impact / 15), ok = near > 0 && this.out.shot(sources.impact, 1.15 - 0.35 * hard, (0.25 + 0.75 * hard) * near, pan);
      audioLog('sfx', 'vehicle.impact', ok, `${tag} ${vehicle.impact.toFixed(1)} m/s ${describe(sources.impact)}`);
    }
  }
  private hush(id: string, heard: Heard): void {
    for (const voice of [heard.loop, heard.skid, heard.horn, heard.wind]) voice?.stop();
    if (heard.loop !== null) audioLog('sfx', 'vehicle.loop.end', true, id);
    heard.loop = heard.skid = heard.horn = heard.wind = null;
  }
}


/** The engine's own vehicle sounds, as mono samples at `rate` Hz: rendered a little past their length, and that tail
 *  crossfaded over the start, so each loops with no seam. */
export function vehicleSynth(synth: VehicleSynth, rate: number): Float32Array {
  const seconds = synth === 'horn' ? 0.5 : synth === 'wind' ? 2 : 1, frames = Math.round(rate * seconds), fade = Math.round(rate * 0.02);
  const rendered = ownedArray(Float32Array, frames + fade, SYNTH_OWNER);
  let seed = 0x2545f491, low = 0, lower = 0;
  const wave = (hz: number, i: number): number => Math.sin(2 * Math.PI * hz * i / rate);
  for (let i = 0; i < rendered.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const white = seed / 2 ** 31 - 1;
    low += 0.08 * (white - low); lower += 0.03 * (low - lower);
    rendered[i] = synth === 'loop' ? (0.4 * wave(56, i) + 0.22 * wave(112, i) + 0.1 * wave(168, i) + 0.8 * low) * (0.55 + 0.45 * Math.max(0, wave(28, i)))
      : synth === 'skid' ? 0.5 * white * (0.7 + 0.3 * wave(9, i)) + 0.08 * wave(1100, i)
        : synth === 'horn' ? 0.45 * wave(440, i) + 0.3 * wave(554, i) + 0.05 * wave(880, i)
          : 2.2 * lower * (0.6 + 0.4 * wave(0.5, i));
  }
  const samples = ownedArray(Float32Array, frames, SYNTH_OWNER);
  for (let i = 0; i < frames; i++) {
    const tail = i < fade ? rendered[frames + i] ?? 0 : 0, k = i < fade ? i / fade : 1;
    samples[i] = (rendered[i] ?? 0) * k + tail * (1 - k);
  }
  return samples;
}

/**
 * MSZ15: a page's mixer as the vehicles' sound out. Loops and shots go through the sfx bus, a gain and a stereo pan. A
 * recording is read once (`read`, the page's audio reader: a declared path to its bytes) and decoded on the page's context;
 * until it is, or with no reader, the slot plays the engine's synth. The engine's voice families play through `audio.voices`.
 */
export function audioVehicleOut(audio: () => Audio | null, read?: (path: string) => Promise<ArrayBuffer>): VehicleSoundOut {
  const decoded = new Map<string, AudioBuffer | null>(), synths = new Map<string, AudioBuffer>();
  const synthBuffer = (ctx: BaseAudioContext, synth: VehicleSynth): AudioBuffer => {
    const key = `${synth}@${String(ctx.sampleRate)}`; let buffer = synths.get(key);
    if (buffer === undefined) { const samples = vehicleSynth(synth, ctx.sampleRate); buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate); buffer.getChannelData(0).set(samples); synths.set(key, buffer); }
    return buffer;
  };
  const pending = new Set<string>();
  /** A source's buffer: null for a voice family, and while its recording decodes; a recording that failed plays the synth. */
  const bufferOf = (ctx: BaseAudioContext, source: VehicleSoundSource): AudioBuffer | null => {
    if (source.kind === 'voice') return null;
    if (source.kind === 'synth' || read === undefined) return synthBuffer(ctx, source.synth);
    const { path } = source, known = decoded.get(path);
    if (known !== undefined) return known ?? synthBuffer(ctx, source.synth);
    if (!pending.has(path)) {
      pending.add(path);
      void (async (): Promise<void> => {
        try { decoded.set(path, await ctx.decodeAudioData(await read(path))); audioLog('sfx', 'vehicle.sample', true, path); }
        catch (error) { decoded.set(path, null); audioLog('sfx', 'vehicle.sample', false, `${path} ${String(error)}`); }
        finally { pending.delete(path); }
      })();
    }
    return null;
  };
  const chain = (mixer: Audio, buffer: AudioBuffer, loop: boolean): { readonly source: AudioBufferSourceNode; readonly gain: GainNode; readonly pan: StereoPannerNode } => {
    const ctx = mixer.ctx, source = ownAudioSource(ctx.createBufferSource()), gain = ctx.createGain(), pan = ctx.createStereoPanner();
    source.buffer = buffer; source.loop = loop; gain.gain.value = 0;
    source.connect(gain).connect(pan).connect(mixer.bus('sfx'));
    return { source, gain, pan };
  };
  return {
    prepare: sources => {
      const mixer = audio(); if (mixer === null || !mixer.ready) return;
      for (const source of Object.values(sources)) if (source.kind === 'sample' && !decoded.has(source.path)) bufferOf(mixer.ctx, source);
    },
    listenerYaw: () => audio()?.listenerYaw ?? 0,
    loop: source => {
      const mixer = audio(); if (mixer === null || !mixer.ready) return null;
      const buffer = bufferOf(mixer.ctx, source); if (buffer === null) return null;
      const { source: node, gain, pan } = chain(mixer, buffer, true), ctx = mixer.ctx;
      // a loop starts at a random point of its sample, so two of a kind never run in step
      node.start(ctx.currentTime, audioRandom() * buffer.duration);
      let stopped = false;
      return {
        set: (rate, level, side) => {
          if (stopped) return;
          const now = ctx.currentTime;
          node.playbackRate.setTargetAtTime(rate, now, 0.05); gain.gain.setTargetAtTime(level, now, 0.05); pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, side)), now, 0.05);
        },
        stop: () => {
          if (stopped) return; stopped = true;
          const now = ctx.currentTime; gain.gain.setTargetAtTime(0, now, 0.04); node.stop(now + 0.25);
          node.onended = () => { node.disconnect(); gain.disconnect(); pan.disconnect(); };
        },
      };
    },
    shot: (source, rate, level, side) => {
      const mixer = audio(); if (mixer === null || !mixer.ready) return false;
      if (source.kind === 'voice') return mixer.voices.play(source.family, { rate, gain: level, pan: side }) !== undefined;
      const buffer = bufferOf(mixer.ctx, source); if (buffer === null) return false;
      const { source: node, gain, pan } = chain(mixer, buffer, false);
      node.playbackRate.value = rate; gain.gain.value = level; pan.pan.value = Math.max(-1, Math.min(1, side));
      node.onended = () => { node.disconnect(); gain.disconnect(); pan.disconnect(); };
      node.start();
      return true;
    },
  };
}

/** MSZ15: a declared recording's bytes by its path, through a product's content-addressed reader (`audio.recordings`). */
export function recordingReader(audio: Pick<AudioData, 'recordings'>, readHash: (hash: string) => Promise<Uint8Array>): (path: string) => Promise<ArrayBuffer> {
  return async path => {
    const hash = audio.recordings?.[path];
    if (hash === undefined) throw new Error(`Undeclared audio recording: ${path}`);
    return Uint8Array.from(await readHash(hash)).buffer;
  };
}
/** MSZ15: what a page lends its vehicles to sound (`FollowedVehiclePorts.sounds`): the page's current mixer, the product's
 *  cues and recordings, and its reader for them. */
export function vehicleSoundPort(audio: Pick<AudioData, 'cues' | 'recordings'>, read?: (path: string) => Promise<ArrayBuffer>): { readonly out: VehicleSoundOut; readonly audio: Pick<AudioData, 'cues' | 'recordings'> } {
  return { out: audioVehicleOut(() => app.audio, read), audio };
}
