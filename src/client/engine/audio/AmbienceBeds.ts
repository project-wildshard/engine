import { AmbienceZones } from './ambience';
import { loopAt, panFromYaw } from './util';
import type { Audio, SampleLoop } from './Audio';
import type { AudioMixer } from './levelAudio';
import type { Scope } from '../../../shared/engine/app/scope';
import { Vector3 } from 'three';
import type { CuePlayer } from './Cues';
import type { AudioSampleMix, AudioMixExpr } from '@wildshard/format/audioProfiles';
import { audioMixValue, requireAudioProfile, type AudioZoneProfile } from '../../../shared/engine/audio/audioProfiles';
import { app } from '../app/runtime';
import { Rng, fnv1a32 } from '../../../shared/engine/core/rng';
import { tap, ambientTick } from '../../../shared/engine/core/harnessTap';

interface LoopVoice { gain: GainNode; pan: StereoPannerNode; stop: () => void }
function loopVoice(audio: AudioMixer, sample: SampleLoop, scope: Scope, random: () => number): LoopVoice {
  const ctx = audio.ctx, source = ctx.createBufferSource(), gain = ctx.createGain(), pan = ctx.createStereoPanner();
  gain.gain.value = 0;
  source.connect(gain).connect(pan).connect(audio.bus('ambience'));
  let started = false, stopped = false;
  let forget = (): void => { /* Installed below before playback. */ };
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    try { if (started) source.stop(); }
    finally { source.disconnect(); gain.disconnect(); pan.disconnect(); forget(); }
  };
  forget = scope.capture('sounds', stop);
  try { loopAt(source, sample.buffer, sample, random, ctx.currentTime); started = true; }
  catch (error) { stop(); throw error; }
  return { gain, pan, stop };
}
interface BedDef { id: string; zone: string; sample: () => SampleLoop | undefined; started: () => void }
type ZoneWeights = Readonly<Record<string, number>>;
/** Zone weights fade N beds through the ambience bus without starting an audio device before a gesture. */
export class AmbienceBeds {
  private readonly zones: AmbienceZones;
  private readonly audio: AudioMixer;
  private readonly scope: Scope;
  private readonly beds: readonly BedDef[];
  private readonly weights: (pos: Vector3) => ZoneWeights;
  private readonly fade: number;
  constructor(audio: AudioMixer, scope: Scope, beds: readonly BedDef[], weights: (pos: Vector3) => ZoneWeights, fade: number, random: () => number) {
    this.audio = audio; this.scope = scope; this.beds = beds; this.weights = weights; this.fade = Math.max(0.05, fade);
    this.zones = new AmbienceZones(audio, random, scope);
  }
  update(pos: Vector3): void {
    if (!this.audio.ready || this.scope.disposed) return;
    const weights = this.weights(pos);
    for (const bed of this.beds) {
      const sample = bed.sample(); if (!sample) continue;
      this.zones.mix({ id: bed.id, panned: true, started: bed.started }, sample,
        sample.gain * Math.min(1, Math.max(0, weights[bed.zone] ?? 0)), this.fade / 3, -Infinity);
    }
  }
  get audible(): string[] { return [...this.zones.beds.keys()]; }
}
/** Select at most max nearest audible loops. Removed voices stop immediately and release their scope handles. */
export class PositionalLoops {
  private readonly voices = new Map<number, LoopVoice>();
  private readonly audio: AudioMixer;
  private readonly scope: Scope;
  private readonly points: readonly Vector3[];
  private readonly sample: () => SampleLoop | undefined;
  private readonly started: () => void;
  private readonly random: () => number;
  readonly max: number;
  readonly reach: number;
  constructor(audio: AudioMixer, scope: Scope, points: readonly Vector3[], sample: () => SampleLoop | undefined, started: () => void,
    random: () => number, max = 4, reach = 14) {
    this.audio = audio; this.scope = scope; this.points = points; this.sample = sample; this.started = started;
    this.random = random; this.max = max; this.reach = reach;
    scope.onDispose(() => { this.voices.clear(); });
  }
  update(pos: Vector3, yaw: number): void {
    if (!this.audio.ready || this.scope.disposed) return;
    const sample = this.sample();
    if (!sample) return;
    const nearest = this.points.map((point, index) => ({ point, index, distance: point.distanceTo(pos) }))
      .filter((p) => p.distance < this.reach).sort((a, b) => a.distance - b.distance).slice(0, this.max);
    const ids = new Set(nearest.map((p) => p.index));
    for (const [index, voice] of this.voices) if (!ids.has(index)) { voice.stop(); this.voices.delete(index); }
    const time = this.audio.ctx.currentTime;
    for (const { point, index, distance } of nearest) {
      let voice = this.voices.get(index);
      if (!voice) { voice = loopVoice(this.audio, sample, this.scope, this.random); this.voices.set(index, voice); this.started(); }
      const dx = point.x - pos.x, dz = point.z - pos.z;
      voice.pan.pan.setTargetAtTime(panFromYaw(dx, dz, yaw, 1, distance, 0.1), time, 0.1);
      voice.gain.gain.setTargetAtTime(sample.gain * 0.22 * (1 - distance / this.reach) ** 2, time, 0.2);
    }
  }
  get count(): number { return this.voices.size; }
}

const sampleStreams = new Map<string, Rng>();
/** Client-only sampled ambience over native mixer/bank owners. Rows contain all
 * mix algebra, zone hysteresis, call cadence and random-stream identity. */
export class SampledAmbience {
  readonly inputs: Record<string, number>;
  readonly diag: Record<string, number> = { sampled: 0, calls: 0 };
  readonly values: Map<string, number> = new Map<string, number>();
  readonly zones: AmbienceZones;
  zone: string;
  private readonly rows: AudioSampleMix;
  private readonly random: () => number;
  private readonly timers: number[];
  private readonly at = new Vector3();
  private readonly ear = new Vector3();
  private lead: string;
  private leadTime = 0;
  private first = true;
  private readonly read = (id: string): number => requireAudioProfile(this.values.get(id) ?? this.inputs[id], id);
  private value(expr: AudioMixExpr): number { return audioMixValue(expr, this.read); }
  private readonly audio: Audio;
  private readonly profile: AudioZoneProfile;
  private readonly bank: CuePlayer | undefined;
  constructor(audio: Audio, profile: AudioZoneProfile, bank?: CuePlayer, scope?: Scope) {
    this.audio = audio; this.profile = profile; this.bank = bank;
    this.rows = requireAudioProfile(profile.sampleMix, 'sample mix');
    this.inputs = { ...this.rows.initial };
    const random = this.rows.random;
    if (random.kind === 'seeded') {
      let stream = sampleStreams.get(random.salt);
      if (stream === undefined) { stream = new Rng(fnv1a32(`${String(app.rng.seedValue)}:${random.salt}`)); sampleStreams.set(random.salt, stream); }
      const seeded = stream; this.random = () => seeded.next();
    } else this.random = () => app.rng.stream(random.id).next();
    this.zones = new AmbienceZones(audio, this.random, scope);
    this.zone = this.lead = requireAudioProfile(this.rows.zones[0], 'initial sample zone').id;
    this.timers = this.rows.calls.map(row => this.between(row.initial));
    for (const row of this.rows.beds) this.diag[row.id] = 0;
    for (const [id, expr] of this.rows.diagnostics) this.diag[id] = this.value(expr);
  }
  private between(range: readonly [number, number]): number { return range[0] + this.random() * (range[1] - range[0]); }
  private sample(id: string): SampleLoop | undefined { return this.bank === undefined ? this.audio.loop(id) : this.bank.loop(id); }
  get audible(): string[] { return [...this.zones.beds.keys()]; }
  /** Re-evaluate explicit scalar inputs in declared order, retaining source gains. */
  set(inputs: Readonly<Record<string, number>>): void {
    Object.assign(this.inputs, inputs); this.values.clear();
    for (const [id, expr] of this.rows.values) this.values.set(id, this.value(expr));
    const selected = this.selected();
    if (this.first) { this.first = false; this.zone = this.lead = selected; }
  }
  /** Apply gains after the caller publishes any score scene change. */
  mix(): void {
    if (!this.audio.ready) return;
    let sampled = 0;
    for (const row of this.rows.beds) {
      const sample = this.sample(row.id);
      if (sample !== undefined) sampled++;
      if (sample === undefined && row.keepSilent) continue;
      const level = sample === undefined ? 0 : this.value(row.level) * sample.gain;
      this.zones.mix({ id: row.id, panned: row.panned, started: () => { if (row.ambient) tap.sound?.(row.tap, 'ambient'); else tap.sound?.(row.tap); } },
        sample, level, this.profile.smoothSeconds, row.keepSilent ? -Infinity : 0.002);
      this.diag[row.id] = Math.round(level * 1000) / 1000;
    }
    this.diag['sampled'] = sampled;
    for (const [id, expr] of this.rows.diagnostics) this.diag[id] = this.value(expr);
    const time = this.audio.ctx.currentTime;
    for (const [id, pan] of this.rows.pans) this.zones.beds.get(id)?.pan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, this.value(pan))), time, this.profile.smoothSeconds);
  }
  private selected(): string {
    let selected = requireAudioProfile(this.rows.zones[0], 'sample zone').id, best = -Infinity;
    for (const row of this.rows.zones) { const weight = this.value(row.weight); if (weight > best) { best = weight; selected = row.id; } }
    return selected;
  }
  /** Native frame clock: hold zones before selection and stop silent sources.
   * Rows preserve reset-before/after emission order for their random draws. */
  advance(dt: number, listener: { x: number; y: number; z: number }, yaw: number): void {
    const top = this.selected();
    if (top !== this.lead) { this.lead = top; this.leadTime = 0; }
    this.leadTime += dt;
    if (this.lead !== this.zone && this.leadTime >= this.profile.holdSeconds) this.zone = this.lead;
    if (!this.audio.ready) return;
    if (this.profile.silentSeconds > 0) this.zones.silence(dt, this.profile.silentSeconds);
    for (let i = 0; i < this.timers.length; i++) if (this.value(requireAudioProfile(this.rows.calls[i], 'sample call').advance) !== 0) this.timers[i] = requireAudioProfile(this.timers[i], 'sample timer') - dt;
    this.rows.calls.forEach((row, i) => {
      if (this.value(row.advance) === 0 || requireAudioProfile(this.timers[i], 'sample timer') > 0) return;
      const run = (): void => {
        if (row.reset === 'before') this.timers[i] = this.between(row.every);
        if (this.value(row.when) !== 0) {
          const emit = row.emit;
          if (emit.kind === 'cue') this.audio.cue(emit.id, { gain: emit.gain });
          else {
            const choice = emit.choices.length === 1 || this.random() < emit.chance ? emit.choices[0] : emit.choices[1];
            const angle = this.random() * Math.PI * 2, distance = this.between(emit.distance);
            this.ear.set(listener.x, listener.y, listener.z);
            this.at.set(listener.x + Math.cos(angle) * distance, listener.y + emit.up, listener.z + Math.sin(angle) * distance);
            this.diag['calls'] = (this.diag['calls'] ?? 0) + 1;
            this.audio.animal(requireAudioProfile(choice, 'sample call'), this.at, this.ear, yaw);
          }
        }
        if (row.reset === 'after') this.timers[i] = this.between(row.every);
      };
      if (row.tick === null) run(); else ambientTick(row.tick, run);
    });
  }
  dispose(): void { this.zones.dispose(); }
}
