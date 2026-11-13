import { resourceScope } from '../../../shared/engine/app/resources';
import {audioInterval,audioTimeout,audioIdle} from './activityTimers';
import { observeAudioMemory } from '../../../shared/engine/core/memoryResources';
import { withOwner } from '../../../shared/engine/app/ownership';
import { ownAudioSource } from './ownership';
import { tap, ambientTick } from '../../../shared/engine/core/harnessTap';
// src/client/engine/audio/Music.ts — the Wildshard score, played by a small WebAudio instrument set (project/archive/2026-09-23-music.md).
//
//   const music = new Music(audio);                 // its own `music` gain → audio.master; shares the AudioContext
//   music.play('theme');                            // on ENTER (after audio.resume()); loops D → B for as long as it plays
//   music.setState({ mode: 'menu' | 'calm' | 'alert' | 'combat', intensity: 0..1, underwater: false });
//   music.sting('pickup' | 'death' | 'chunk');      // the bell motif · the minor turn then 6 s of silence · the resolve chord
//   music.stop();                                   // fades the bus over a bar and silences every voice
//   music.volume = 0.7;                             // persisted as Settings 'music' (the pause menu's MUSIC slider drives it)
//   await music.renderOffline('trailer30', 28.2);   // the same graph on an OfflineAudioContext (48 kHz stereo) → AudioBuffer
//
// Instruments (7 patches, all here): drone (two detuned saws an octave apart through a slow low-pass) · pad (4-voice
// chord, triangle + sine, slow attack) · pluck (Karplus-Strong: a noise burst through a feedback delay line — computed
// into a buffer, because a DelayNode feedback loop bottoms out at one render quantum = 375 Hz at 48 kHz, under the motif)
// · marimba (sine + 4th-harmonic sine, exponential decay) · bass (sine + a little saw, sidechained to the kick) · pulse
// (filtered-noise shaker, a tap, a low sine kick) · bell (2-operator FM).
//
// Sequencer: bars are scheduled 2 bars ahead on the AudioContext clock from a 120 ms timer (no per-frame work, no
// AudioWorklet / ScriptProcessor). Layer levels crossfade over one bar starting on a bar; tempo and the Lydian → Dorian
// switch change on a bar (pending bars are cancelled and rescheduled when the state changes). Under water the whole
// music bus runs through a 600 Hz low-pass and a slow chorus. `renderOffline` runs the identical scheduler on an
// OfflineAudioContext — the trailer render and the live playback are one code path.
//
// v3 (project/archive/2026-09-23-music.md rows 7–8): a STEM PLAYER beside the synth (src/client/engine/audio/Stems.ts). The engine
// plays one style, piano (MiniMax-Music3 stems in public/assets/music/piano/; J304, AUDIO AU16: no style choice). Its files are
// downloaded at the loading bar and its title + this shard's slot + stings are decoded there (project/archive/2026-09-23-preload-offline.md;
// `useBank`), so play() starts the stems at once; the synth plays only for a slot the build lacks or that failed to decode.
// Slots: menu → 'title' (main.ts starts the music on the title screen's first gesture), Pine Hollow → 'pine', Driftwood → 'island';
// ENTER WORLD / exit-to-menu crossfade between them over a bar. calm / alert / combat drive the tension stem's gain (0 / 0.5 / 1)
// on the deck's bar grid. Underwater is the same low-pass (the stems run through the engine's bus). A slot change crossfades
// over at least a bar; a retired title is decoded again from the offline cache (Cache Storage, never the network) while the
// deck plays on. `music.duck(k)` scales the whole bus
// (the Driftwood shrine's −3 dB, src/shards/driftwood-isle/audio/shrineHum.ts).
//
import type { Audio } from './Audio';
import { audioUnlocked, whenAudioUnlocked } from './unlock';
import type { Scope } from '../../../shared/engine/app/scope';
import { getNumber, setNumber, onNumber } from '../ui/Settings';
import { Deck, decodeStyle, type SlotAudio, type StyleBank } from './Stems';
import { AacTrack } from './aacTrack';
import { cachedBytes, decodeBytes, trackBusy } from './preload';
import { audioLog } from './audioLog';
import type { ScoreSource } from './SetScore';
import { score, type Arrangement, type ChordName, type LayerId, type MixKey, type NoteEv, type Segment } from './score/score';
import { ENGINE_MUSIC_STYLE, type MusicStyle as MusicGenre, type BossPhase, type SlotName } from '../../../shared/engine/audio/bootAudio';

/** an arrangement's name in the installed score (the game's: theme, trailer30, trailer15) */
type ArrangementName = string;
/** the installed score's lookups, checked: a chord the score lacks voices nothing, an arrangement it lacks is a bug */
const chordPitches = (c: ChordName): readonly number[] => score().chords[c] ?? [];
const chordRoot = (c: ChordName): number => score().chordRoot[c] ?? 0;
const dorianOf = (c: ChordName): ChordName => score().dorianOf[c] ?? c;
function arrangementOf(name: ArrangementName): Arrangement {
  const arr = score().arrangements[name];
  if (arr === undefined) throw new Error(`Music: the score has no arrangement '${name}'`);
  return arr;
}

export type MusicMode = 'menu' | 'calm' | 'alert' | 'combat';
export type StingName = 'pickup' | 'death' | 'chunk' | 'dawn';
export interface MusicState { lead?: 'pluck' | 'marimba'; mode: MusicMode; intensity: number; underwater: boolean }

const LOOKAHEAD_BARS = 2;
const TICK_MS = 120;
const TEMPO: Record<MusicMode, number> = { menu: 104, calm: 96, alert: 100, combat: 112 };
type GainKey = Exclude<MixKey, 'lpf' | 'chorus'>;
const GAIN_KEYS: GainKey[] = ['drone', 'pad', 'pluck', 'marimba', 'bass', 'pulse', 'pulse.soft', 'pulse.kick', 'pulse.four', 'bell'];
const midiHz = (n: number) => 440 * 2 ** ((n - 69) / 12);

interface Voice { srcs: AudioScheduledSourceNode[]; out: GainNode }
interface PadVoice extends Voice { release: (t: number, secs: number) => void; unrelease: () => void; releaseAt?: number | undefined }
interface Bar {
  segIdx: number; beat0: number; beats: number; t0: number; spb: number;
  voices: Voice[];
  /** the state to restore if this bar is cancelled (the sequencer rewinds to it) */
  before: { pad: PadVoice | undefined; targets: Partial<Record<MixKey, number>>; lastChord: ChordName | undefined };
}

/** the context-agnostic core: instruments + mixer + sequencer. `Music` wraps it for the live game. */
class Engine {
  readonly ctx: BaseAudioContext;
  /** volume → lpf → (dry | chorus) → dest */
  readonly bus: GainNode;
  /** the sequencer's layers sum here; the death sting ducks it while the sting itself bypasses (stingBus) */
  readonly seq: GainNode;
  /** the synth's share of the bus: 1 alone, faded to 0 while the stems play (Music hands over on a bar) */
  readonly synthMix: GainNode;
  readonly stingBus: GainNode;
  readonly lpf: BiquadFilterNode;
  readonly chorusWet: GainNode;
  readonly gains = {} as Record<GainKey, GainNode>;
  private bassDuck: GainNode;
  private noise: AudioBuffer;
  private ks = new Map<number, AudioBuffer>();
  private padFilter: BiquadFilterNode;
  private droneNodes: AudioScheduledSourceNode[] = [];
  private pad: PadVoice | undefined;
  private lastChord: ChordName | undefined;
  private targets: Partial<Record<MixKey, number>> = {};
  private pans = {} as Partial<Record<GainKey, StereoPannerNode>>;
  // sequencer
  arrangement: Arrangement | undefined;
  private segIdx = 0; private beat0 = 0; private nextT = 0;
  private bars: Bar[] = [];
  state: MusicState = { mode: 'menu', intensity: 0, underwater: false };
  /** Only these layers sound during per-layer offline level checks. */
  solo: Set<string> | undefined;
  /** diagnostics: scheduled notes / bars, scheduler main-thread time; `liveOsc(now)` counts the oscillators sounding at `now` */
  stats = { notes: 0, bars: 0, schedMs: 0, schedMax: 0 };
  private oscSpans: { t0: number; t1: number }[] = [];
  private spanOf = new WeakMap<AudioScheduledSourceNode, { t0: number; t1: number }>();
  /** an oscillator's stop time moved (a pad released, a bar cancelled): keep the live count honest */
  private restop(o: AudioScheduledSourceNode, t1: number) { const sp = this.spanOf.get(o); if (sp) sp.t1 = t1; }
  liveOsc(now: number = this.ctx.currentTime): number {
    this.oscSpans = this.oscSpans.filter((o) => o.t1 > now - 1);
    let n = 0; for (const o of this.oscSpans) if (o.t0 <= now && o.t1 > now) n++;
    return n;
  }

  private readonly memoryOwner: string;
  constructor(ctx: BaseAudioContext, dest: AudioNode, memoryOwner: string) {
    this.memoryOwner = memoryOwner;
    this.ctx = ctx;
    const c = ctx;
    this.bus = c.createGain(); this.bus.gain.value = 1;
    this.lpf = c.createBiquadFilter(); this.lpf.type = 'lowpass'; this.lpf.frequency.value = 20000; this.lpf.Q.value = 0.4;
    this.bus.connect(this.lpf);
    const dry = c.createGain(); dry.gain.value = 1; this.lpf.connect(dry).connect(dest);
    // the underwater chorus: a 14 ms delay wobbled ±5 ms at 0.35 Hz, mixed in by `chorusWet`
    const delay = c.createDelay(0.1); delay.delayTime.value = 0.014;
    const lfo = ownAudioSource(c.createOscillator()); lfo.frequency.value = 0.35; const lg = c.createGain(); lg.gain.value = 0.005;
    lfo.connect(lg).connect(delay.delayTime); lfo.start();
    this.chorusWet = c.createGain(); this.chorusWet.gain.value = 0;
    this.lpf.connect(delay).connect(this.chorusWet).connect(dest);
    this.seq = c.createGain(); this.synthMix = c.createGain(); this.seq.connect(this.synthMix).connect(this.bus);
    this.stingBus = c.createGain(); this.stingBus.gain.value = 1; this.stingBus.connect(this.bus);
    // layers
    for (const k of GAIN_KEYS) { const g = c.createGain(); g.gain.value = 0; this.gains[k] = g; this.targets[k] = 0; }
    for (const k of ['drone', 'pad', 'pluck', 'marimba', 'bass', 'pulse', 'bell'] as GainKey[]) this.gains[k].connect(this.seq);
    for (const k of ['pulse.soft', 'pulse.kick', 'pulse.four'] as GainKey[]) this.gains[k].connect(this.gains.pulse);
    this.gains.pulse.gain.value = 1; this.targets.pulse = 1;
    this.padFilter = c.createBiquadFilter(); this.padFilter.type = 'lowpass'; this.padFilter.frequency.value = 2400; this.padFilter.Q.value = 0.5;
    this.padFilter.connect(this.gains.pad);
    this.bassDuck = c.createGain(); this.bassDuck.gain.value = 1;
    const bassLp = c.createBiquadFilter(); bassLp.type = 'lowpass'; bassLp.frequency.value = 420; bassLp.Q.value = 0.8;
    this.bassDuck.connect(bassLp).connect(this.gains.bass);
    for (const [k, p] of [['pluck', -0.22], ['marimba', 0.25], ['bell', 0.08]] as [GainKey, number][]) {
      if (!('createStereoPanner' in c)) continue; // older Safari
      const pan = c.createStereoPanner(); pan.pan.value = p; pan.connect(this.gains[k]); this.pans[k] = pan;
    }
    // 2 s of white noise for the shaker / kick click / Karplus burst
    const len = Math.floor(c.sampleRate * 2);
    this.noise = observeAudioMemory(c.createBuffer(1, len, c.sampleRate), { owner: this.memoryOwner, asset: 'audio/music/synth/noise' });
    const d = this.noise.getChannelData(0); let s = 1234567;
    for (let i = 0; i < len; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
  }

  // ─────────────── helpers ───────────────
  private into(k: GainKey): AudioNode { return this.pans[k] ?? this.gains[k]; }
  private track(o: AudioScheduledSourceNode, t0?: number, t1?: number) {
    if (o instanceof OscillatorNode && t0 !== undefined && t1 !== undefined && this.oscSpans.length < 4096) { const sp = { t0, t1 }; this.oscSpans.push(sp); this.spanOf.set(o, sp); }
  }
  private env(g: AudioParam, t: number, peak: number, attack: number, decay: number, hold = 0) {
    g.setValueAtTime(0.0001, t);
    g.linearRampToValueAtTime(peak, t + attack);
    if (hold > 0) g.setValueAtTime(peak, t + attack + hold);
    g.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
  }
  private osc(type: OscillatorType, f: number, t0: number, t1: number, detune = 0): OscillatorNode {
    const o = ownAudioSource(this.ctx.createOscillator()); o.type = type; o.frequency.value = f; o.detune.value = detune;
    o.start(t0); o.stop(t1); this.track(o, t0, t1); return o;
  }
  private noiseSrc(t0: number, t1: number, rate = 1): AudioBufferSourceNode {
    const s = ownAudioSource(this.ctx.createBufferSource()); s.buffer = this.noise; s.loop = true; s.playbackRate.value = rate;
    s.start(t0, (t0 * 7.31) % 1.5); s.stop(t1); return s;
  }

  // ─────────────── the seven patches ───────────────
  /** drone: D2 and D3 saws, the upper one 6 cents flat, through a low-pass that breathes between ~170 and ~400 Hz */
  startDrone(t: number): void {
    tap.sound?.('music.drone');
    this.stopDrone();
    const c = this.ctx, far = 1e9;
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 260; lp.Q.value = 0.9;
    const lfo = ownAudioSource(c.createOscillator()); lfo.frequency.value = 0.045; const lg = c.createGain(); lg.gain.value = 110;
    lfo.connect(lg).connect(lp.frequency); lfo.start(t); lfo.stop(far);
    const a = this.osc('sawtooth', midiHz(38), t, far, 3), b = this.osc('sawtooth', midiHz(50), t, far, -6);
    const ga = c.createGain(); ga.gain.value = 0.09; const gb = c.createGain(); gb.gain.value = 0.062;
    a.connect(ga).connect(lp); b.connect(gb).connect(lp); lp.connect(this.gains.drone);
    this.droneNodes = [a, b, lfo];
  }
  stopDrone(): void { for (const n of this.droneNodes) { try { n.stop(); } catch { /* not started */ } } this.droneNodes = []; }

  /** pad: 4 voices, the root a sine and the rest triangles, each a few cents off, a slow attack; released when the next chord lands */
  padVoice(chord: ChordName, t: number, attack: number, out: AudioNode = this.padFilter): PadVoice {
    tap.sound?.('music.padVoice');
    const c = this.ctx, pitches = chordPitches(chord), det = [0, 6, -5, 4], pan = [-0.35, 0.3, -0.15, 0.25];
    const g = c.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(1, t + attack);
    g.connect(out);
    const srcs: AudioScheduledSourceNode[] = [];
    pitches.forEach((n, i) => {
      const o = this.osc(i === 0 ? 'sine' : 'triangle', midiHz(n), t, t + 3600, det[i] ?? 0);
      const vg = c.createGain(); vg.gain.value = i === 0 ? 0.24 : 0.155;
      let node: AudioNode = vg;
      if ('createStereoPanner' in c) { const p = c.createStereoPanner(); p.pan.value = pan[i] ?? 0; vg.connect(p); node = p; }
      o.connect(vg); node.connect(g); srcs.push(o);
    });
    const v: PadVoice = {
      srcs, out: g,
      release: (tr, secs) => {
        v.releaseAt = tr;
        g.gain.cancelScheduledValues(tr); g.gain.setValueAtTime(Math.max(0.0001, this.valueAt(g.gain, tr, t, attack)), tr);
        g.gain.exponentialRampToValueAtTime(0.0001, tr + secs);
        // the tail is −48 dB by 60 % of the release: stop the oscillators there (the budget is 12 live)
        for (const o of srcs) { o.stop(tr + secs * 0.6 + 0.05); this.restop(o, tr + secs * 0.6 + 0.05); }
      },
      // a cancelled bar scheduled the release: take it back (the release lies in the future, so cancelling from it is exact)
      unrelease: () => {
        if (v.releaseAt === undefined) return;
        const tr = v.releaseAt; v.releaseAt = undefined;
        g.gain.cancelScheduledValues(tr); g.gain.setValueAtTime(Math.max(0.0001, this.valueAt(g.gain, tr, t, attack)), tr);
        for (const o of srcs) { o.stop(t + 3600); this.restop(o, t + 3600); }
      },
    };
    return v;
  }
  /** the pad gain at `tr`, given a linear attack that started at `t` (release may land mid-attack) */
  private valueAt(_p: AudioParam, tr: number, t: number, attack: number) { return Math.min(1, Math.max(0, (tr - t) / attack)); }

  /** pluck: Karplus-Strong — a noise burst through a feedback delay of 1/f with a 2-point low-pass, computed into a buffer per pitch */
  pluck(n: number, t: number, _d: number, v: number, out: AudioNode = this.into('pluck')) {
    tap.sound?.('music.pluck');
    const buf = this.ksBuffer(midiHz(n));
    const s = ownAudioSource(this.ctx.createBufferSource()); s.buffer = buf; s.start(t); s.stop(t + buf.duration);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(0.34 * v, t); g.gain.setValueAtTime(0.34 * v, t + buf.duration - 0.08); g.gain.linearRampToValueAtTime(0.0001, t + buf.duration - 0.005);
    s.connect(g).connect(out);
    return { srcs: [s], out: g } as Voice;
  }
  private ksBuffer(f: number): AudioBuffer {
    const key = Math.round(f * 4);
    const hit = this.ks.get(key); if (hit) return hit;
    const sr = this.ctx.sampleRate, N = Math.max(2, Math.round(sr / f)), secs = f > 500 ? 1.4 : 2.0, len = Math.floor(sr * secs);
    const buf = observeAudioMemory(this.ctx.createBuffer(1, len, sr), { owner: this.memoryOwner, asset: `audio/music/synth/pluck/${key}` }), d = buf.getChannelData(0);
    let s = 987654321 + key;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
    // the burst: white noise, DC removed, a touch of pick-position comb (a copy 30 % of a period later, inverted)
    let mean = 0; for (let i = 0; i < N; i++) { const r = rnd(); d[i] = r; mean += r; } mean /= N;
    for (let i = 0; i < N; i++) d[i] = (d[i] ?? 0) - mean;
    const pick = Math.max(1, Math.round(N * 0.3)); for (let i = N - 1; i >= pick; i--) d[i] = (d[i] ?? 0) - 0.8 * (d[i - pick] ?? 0);
    // a plucked string's burst is not white: one-pole low-pass at ~5 partials (the harmonics roll off ~6 dB/oct)
    const a = 1 - Math.exp((-2 * Math.PI * Math.min(4200, f * 5)) / sr); let y = 0;
    for (let i = 0; i < N; i++) { y += a * ((d[i] ?? 0) - y); d[i] = y; }
    // the loop: y[i] = decay · ½ (y[i−N] + y[i−N−1]) — the averaging is the string's damping
    const decay = f < 200 ? 0.994 : f < 500 ? 0.996 : 0.9975;
    for (let i = N; i < len; i++) d[i] = decay * 0.5 * ((d[i - N] ?? 0) + (d[i - N - 1 < 0 ? 0 : i - N - 1] ?? 0));
    let peak = 0; for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(d[i] ?? 0));
    const k = peak > 0 ? 0.95 / peak : 1; for (let i = 0; i < len; i++) d[i] = (d[i] ?? 0) * k;
    this.ks.set(key, buf);
    return buf;
  }

  /** marimba: a sine and its 4th harmonic (the bar's overtone), 3 ms attack, exponential decay; a tiny mallet click */
  marimba(n: number, t: number, _d: number, v: number, out: AudioNode = this.into('marimba')) {
    tap.sound?.('music.marimba');
    const c = this.ctx, f = midiHz(n), decay = Math.min(1.1, Math.max(0.3, 1.3 - (n - 60) / 40));
    const g = c.createGain(); this.env(g.gain, t, 0.26 * v, 0.003, decay); g.connect(out);
    const o1 = this.osc('sine', f, t, t + decay + 0.05);
    const o2 = this.osc('sine', f * 4, t, t + 0.3); const g2 = c.createGain(); this.env(g2.gain, t, 0.22, 0.002, 0.12);
    o1.connect(g); o2.connect(g2).connect(g);
    const click = this.noiseSrc(t, t + 0.03); const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2800;
    const cg = c.createGain(); this.env(cg.gain, t, 0.09 * v, 0.001, 0.012); click.connect(hp).connect(cg).connect(out);
    return { srcs: [o1, o2, click], out: g } as Voice;
  }

  /** bass: sine + a little saw through the 420 Hz low-pass, 10 ms attack, held for the note, sidechained to the kick */
  bass(n: number, t: number, d: number, v: number, out: AudioNode = this.bassDuck) {
    tap.sound?.('music.bass');
    const c = this.ctx, f = midiHz(n), hold = Math.max(0.05, d - 0.07);
    const g = c.createGain(); this.env(g.gain, t, 0.15 * v, 0.012, 0.07, hold); g.connect(out);
    const o1 = this.osc('sine', f, t, t + hold + 0.15), o2 = this.osc('sawtooth', f, t, t + hold + 0.15, 4);
    const sg = c.createGain(); sg.gain.value = 0.16;
    o1.connect(g); o2.connect(sg).connect(g);
    return { srcs: [o1, o2], out: g } as Voice;
  }

  /** pulse: 36 kick (1 & 3) · 35 the four-on-the-floor kicks · 38 tap · 42 shaker — each to its own sub-bus */
  drum(n: number, t: number, v: number, outOverride?: AudioNode): Voice {
    tap.sound?.('music.drum');
    const c = this.ctx;
    if (n === 36 || n === 35) {
      const out = outOverride ?? this.gains[n === 36 ? 'pulse.kick' : 'pulse.four'];
      const o = this.osc('sine', 135, t, t + 0.4); o.frequency.setValueAtTime(135, t); o.frequency.exponentialRampToValueAtTime(44, t + 0.09);
      const g = c.createGain(); this.env(g.gain, t, 0.36 * v, 0.003, 0.3); o.connect(g).connect(out);
      const click = this.noiseSrc(t, t + 0.03); const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1800;
      const cg = c.createGain(); this.env(cg.gain, t, 0.2 * v, 0.001, 0.014); click.connect(lp).connect(cg).connect(out);
      return { srcs: [o, click], out: g };
    }
    const out = outOverride ?? this.gains['pulse.soft'];
    if (n === 42) {
      const s = this.noiseSrc(t, t + 0.09); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 6400; bp.Q.value = 1.1;
      const g = c.createGain(); this.env(g.gain, t, 0.6 * v, 0.006, 0.055); s.connect(bp).connect(g).connect(out);
      return { srcs: [s], out: g };
    }
    // 38: the tap — a damp knock, noise through a 1.4 kHz band and a 190 Hz thump
    const s = this.noiseSrc(t, t + 0.06); const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1400; bp.Q.value = 1.8;
    const g = c.createGain(); this.env(g.gain, t, 0.9 * v, 0.002, 0.035); s.connect(bp).connect(g).connect(out);
    const o = this.osc('sine', 190, t, t + 0.08); const og = c.createGain(); this.env(og.gain, t, 0.5 * v, 0.002, 0.05); o.connect(og).connect(out);
    return { srcs: [s, o], out: g };
  }

  /** bell: 2-operator FM — a sine carrier, a modulator at 3.5× (the inharmonic bell partial) whose index decays fast */
  bell(n: number, t: number, d: number, v: number, out: AudioNode = this.into('bell')) {
    tap.sound?.('music.bell');
    const c = this.ctx, f = midiHz(n), decay = Math.max(1.2, d);
    const car = this.osc('sine', f, t, t + decay + 0.1), mod = this.osc('sine', f * 3.5, t, t + decay + 0.1);
    const mg = c.createGain(); mg.gain.setValueAtTime(f * 2.8, t); mg.gain.exponentialRampToValueAtTime(f * 0.08, t + 0.8);
    mod.connect(mg).connect(car.frequency);
    const g = c.createGain(); this.env(g.gain, t, 0.3 * v, 0.004, decay); car.connect(g).connect(out);
    return { srcs: [car, mod], out: g } as Voice;
  }

  // ─────────────── mixer ───────────────
  private param(key: MixKey): AudioParam { return key === 'lpf' ? this.lpf.frequency : key === 'chorus' ? this.chorusWet.gain : this.gains[key].gain; }
  private hold(p: AudioParam, t: number) {
    const cp: { cancelAndHoldAtTime?: (t: number) => void } = p; // Firefox has no cancelAndHoldAtTime
    if (cp.cancelAndHoldAtTime) cp.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t);
  }
  /** ramp a layer / effect to `level` starting at `t` over `ramp` seconds (bar-aligned when the sequencer calls it) */
  setLevel(key: MixKey, level: number, t: number, ramp = 0.02): void {
    const target = this.solo && key !== 'lpf' && key !== 'chorus' && !this.solo.has(key) ? 0 : level;
    const p = this.param(key), from = this.targets[key] ?? p.value;
    this.hold(p, t);
    if (key === 'lpf') {
      p.setValueAtTime(Math.max(20, from), t); p.exponentialRampToValueAtTime(Math.max(20, target), t + Math.max(0.005, ramp));
    } else {
      p.setValueAtTime(from, t); p.linearRampToValueAtTime(target, t + Math.max(0.005, ramp));
    }
    this.targets[key] = target;
  }
  /** the game state → layer levels (project/archive/2026-09-23-music.md "In the game"); `menu` follows the arrangement's own mix instead */
  private stateLevels(seg: Segment): Partial<Record<GainKey, number>> {
    const s = this.state, i = Math.min(1, Math.max(0, s.intensity));
    const mine: LayerId = s.lead ?? 'pluck', other: LayerId = mine === 'pluck' ? 'marimba' : 'pluck';
    const motif = mine === 'pluck' ? 0.9 : 0.85;
    void seg;
    if (s.mode === 'combat') return { drone: 1, pad: 0.85, [mine]: 1, [other]: 0.35, bass: 1, 'pulse.soft': 1, 'pulse.kick': 1, 'pulse.four': 0.7 + 0.3 * i, bell: 1 };
    if (s.mode === 'alert') return { drone: 1, pad: 0.8, [mine]: motif, [other]: 0, bass: 0.7 + 0.3 * i, 'pulse.soft': 0.5 + 0.5 * i, 'pulse.kick': 0, 'pulse.four': 0, bell: 1 };
    return { drone: 1, pad: 0.75, [mine]: motif, [other]: 0, bass: 0, 'pulse.soft': 0, 'pulse.kick': 0, 'pulse.four': 0, bell: 1 };
  }
  /** calm / alert let the motif through only in the sections flagged `calmMotif` (B and D: every ~30 s at 96) — gated at the note, so nothing bleeds across a bar */
  private motifGate(seg: Segment) { return this.driven || this.state.mode === 'combat' || seg.calmMotif === true; }
  private get driven() { return this.arrangement?.driven === true || this.state.mode === 'menu'; }
  private get dorian() { return !this.driven && this.state.mode === 'combat'; }
  private bpmFor(seg: Segment) { return seg.at !== undefined || this.arrangement?.driven ? seg.bpm : TEMPO[this.state.mode]; }

  // ─────────────── sequencer ───────────────
  /** fill the Karplus-Strong cache for every pluck pitch the arrangement uses (and their Dorian forms) — ~1 ms each, off the bar schedule */
  warm(arr: Arrangement): void {
    for (const seg of arr.segments) for (const n of seg.notes.pluck ?? []) { this.ksBuffer(midiHz(n.n)); this.ksBuffer(midiHz(score().dorianPitch(n.n))); }
  }
  /** start `arr` at time `t` (the drone comes up with it) */
  begin(arr: Arrangement, t: number): void {
    this.arrangement = arr; this.segIdx = 0; this.beat0 = 0; this.nextT = t; this.bars = []; this.lastChord = undefined;
    this.pad = undefined;
    for (const k of GAIN_KEYS) if (k !== 'pulse') { this.gains[k].gain.cancelScheduledValues(t); this.gains[k].gain.setValueAtTime(0, t); this.targets[k] = 0; }
    this.startDrone(t);
  }
  /** schedule every bar that starts before `until` (the live pump calls this with now + 2 bars; offline, with the render length) */
  pump(until: number): void {
    const arr = this.arrangement; if (!arr) return;
    const now = this.ctx.currentTime;
    let head = this.bars[0];
    while (head !== undefined && head.t0 + head.beats * head.spb < now - 0.5) { this.bars.shift(); head = this.bars[0]; }
    let guard = 0;
    while (this.nextT < until && guard++ < 512) if (!this.scheduleNext()) break;
  }
  private scheduleNext(): boolean {
    const arr = this.arrangement; if (!arr) return false;
    const loopEnd = arr.tailFrom ?? arr.segments.length;
    let seg = arr.segments[this.segIdx];
    if (seg === undefined) return false; // past the last segment
    if (this.beat0 >= seg.beats - 1e-6) {
      this.segIdx++; this.beat0 = 0;
      if (this.segIdx >= loopEnd && arr.loopTo !== undefined) this.segIdx = arr.loopTo;
      seg = arr.segments[this.segIdx];
      if (seg === undefined) return false;
    }
    const spb = 60 / this.bpmFor(seg);
    const t0 = seg.at !== undefined ? seg.at + this.beat0 * spb : this.nextT;
    const beats = Math.min(4, seg.beats - this.beat0);
    const t = performance.now();
    this.scheduleBar(seg, this.segIdx, this.beat0, beats, t0, spb);
    const ms = performance.now() - t; this.stats.schedMs += ms; this.stats.schedMax = Math.max(this.stats.schedMax, ms);
    this.beat0 += beats; this.nextT = t0 + beats * spb;
    return true;
  }
  private scheduleBar(seg: Segment, segIdx: number, beat0: number, beats: number, t0: number, spb: number) {
    const bar: Bar = { segIdx, beat0, beats, t0, spb, voices: [], before: { pad: this.pad, targets: { ...this.targets }, lastChord: this.lastChord } };
    const end = beat0 + beats, at = (b: number) => t0 + (b - beat0) * spb, dorian = this.dorian;
    // mixer: the arrangement's mix events (driven) or the state table (game), crossfading over the bar
    if (this.driven) {
      for (const m of seg.mix ?? []) if (m.t >= beat0 && m.t < end) this.setLevel(m.key, m.level, at(m.t), m.ramp ?? 0.02);
    } else {
      const lv = this.stateLevels(seg);
      for (const k of Object.keys(lv) as GainKey[]) { const level = lv[k]; if (level !== undefined && this.targets[k] !== level) this.setLevel(k, level, t0, beats * spb); }
    }
    // chords → pad (and the drone just holds D)
    for (const c of seg.chords) if (c.t >= beat0 && c.t < end) {
      const name = dorian ? dorianOf(c.chord) : c.chord, tc = at(c.t);
      const attack = Math.min(1.4, Math.max(0.05, spb * 2.2));
      if (this.pad) this.pad.release(tc, Math.max(0.8, spb * 3.2));
      this.pad = this.padVoice(name, tc, attack); this.lastChord = name; bar.voices.push(this.pad);
    }
    // notes
    const notes = seg.notes;
    const each = (list: NoteEv[] | undefined, fn: (n: NoteEv, tn: number) => Voice | undefined) => {
      if (!list) return;
      for (const n of list) if (n.t >= beat0 && n.t < end) { const v = fn(n, at(n.t)); if (v) bar.voices.push(v); this.stats.notes++; }
    };
    const pitch = (n: number) => (dorian ? score().dorianPitch(n) : n), gate = this.motifGate(seg);
    each(gate ? notes.pluck : undefined, (n, tn) => this.pluck(pitch(n.n), tn, n.d * spb, n.v ?? 0.8));
    each(gate ? notes.marimba : undefined, (n, tn) => this.marimba(pitch(n.n), tn, n.d * spb, n.v ?? 0.8));
    each(notes.bass, (n, tn) => this.bass(dorian ? this.dorianRoot(n.n, seg, n.t) : n.n, tn, n.d * spb, n.v ?? 0.8));
    each(notes.bell, (n, tn) => this.bell(pitch(n.n), tn, n.d * spb, n.v ?? 0.8));
    each(notes.pulse, (n, tn) => {
      const v = this.drum(n.n, tn, n.v ?? 0.8);
      if ((n.n === 36 && (this.targets['pulse.kick'] ?? 0) > 0.05) || (n.n === 35 && (this.targets['pulse.four'] ?? 0) > 0.05)) this.sidechain(tn);
      return v;
    });
    this.bars.push(bar); this.stats.bars++;
  }
  /** the bass follows the Dorian chord's root under a Lydian bar */
  private dorianRoot(n: number, seg: Segment, t: number): number {
    const c = [...seg.chords].reverse().find((x) => x.t <= t); if (!c) return n;
    return n - chordRoot(c.chord) + chordRoot(dorianOf(c.chord));
  }
  private sidechain(t: number) {
    const g = this.bassDuck.gain;
    g.setValueAtTime(1, Math.max(0, t - 0.003)); g.linearRampToValueAtTime(0.32, t + 0.012); g.linearRampToValueAtTime(1, t + 0.24);
  }
  /** drop every bar that has not started yet and rewind the cursor to the first of them (state changes take effect on the next bar) */
  cancelPending(now: number): void {
    const i = this.bars.findIndex((b) => b.t0 > now + 0.03);
    if (i === -1) return;
    const first = this.bars[i];
    if (first === undefined) return;
    for (const b of this.bars.splice(i)) for (const v of b.voices) { try { v.out.disconnect(); } catch { /* gone */ } for (const s of v.srcs) { try { s.stop(now); } catch { /* not started */ } this.restop(s, now); } }
    this.pad = first.before.pad; this.lastChord = first.before.lastChord; this.targets = { ...first.before.targets };
    for (const k of GAIN_KEYS) { const p = this.gains[k].gain; this.hold(p, first.t0); p.setValueAtTime(this.targets[k] ?? 0, first.t0); }
    this.bassDuck.gain.cancelScheduledValues(first.t0); this.bassDuck.gain.setValueAtTime(1, first.t0);
    if (this.pad) this.pad.unrelease(); // a cancelled chord had released it; the rescheduled chord will again
    this.segIdx = first.segIdx; this.beat0 = first.beat0; this.nextT = first.t0;
  }
  /** the start of the next bar after `now` (for bar-aligned stops / stings), or now if nothing is scheduled */
  nextBarAfter(now: number): number { const b = this.bars.find((x) => x.t0 > now); return b ? b.t0 : now; }
  currentSpb(): number { const b = this.bars[this.bars.length - 1]; return b ? b.spb : 60 / TEMPO[this.state.mode]; }
  /** silence everything; the bars already scheduled stop at `t` */
  end(t: number): void {
    if (this.pad) this.pad.release(t, 0.4);
    for (const b of this.bars) for (const v of b.voices) { try { v.out.gain.setValueAtTime(v.out.gain.value, t); v.out.gain.linearRampToValueAtTime(0, t + 0.05); } catch { /* */ } for (const s of v.srcs) { try { s.stop(t + 0.1); } catch { /* */ } this.restop(s, t + 0.1); } }
    this.bars = []; this.arrangement = undefined; this.pad = undefined;
    for (const n of this.droneNodes) { try { n.stop(t + 0.1); } catch { /* */ } this.restop(n, t + 0.1); } this.droneNodes = [];
  }

  // ─────────────── stings (their own bus, so the death duck never swallows them) ───────────────
  sting(sting: StingName, t: number): void {
    const spb = this.currentSpb(), name = sting === 'dawn' ? 'chunk' : sting; // the synth has no dawn sting: the discovery chord
    if (name === 'pickup') { for (const n of score().stings.pickup) this.bell(n.n, t + n.t * spb, n.d * spb, n.v ?? 0.6, this.stingBus); return; }
    if (name === 'chunk') {
      const p = this.padVoice(score().stings.chunk.chord, t, 0.03, this.stingBus); p.release(t + 0.4, 2.6);
      for (const n of score().stings.chunk.bell) this.bell(n.n, t + n.t * spb, n.d * spb, n.v ?? 0.6, this.stingBus);
      this.bass(38, t, 1.4, 0.9, this.stingBus); this.drum(36, t, 0.9, this.stingBus);
      return;
    }
    // death: the minor turn — Dm9 → Gm over a bar — then the sequencer ducks to silence for 6 s and comes back over a bar
    const bar = spb * 4;
    const a = this.padVoice(score().stings.death.chords[0], t, 0.05, this.stingBus); a.release(t + bar * 0.5, 1.2);
    const b = this.padVoice(score().stings.death.chords[1], t + bar * 0.5, 0.08, this.stingBus); b.release(t + bar, 2.4);
    for (const n of score().stings.death.bass) this.bass(n.n, t + n.t * spb, n.d * spb, n.v ?? 0.9, this.stingBus);
    this.bell(62, t + bar * 0.5, 3, 0.4, this.stingBus);
    const g = this.seq.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + bar);
    g.setValueAtTime(0, t + bar + 6); g.linearRampToValueAtTime(1, t + bar + 6 + bar);
  }
}

/** the tension stem's gain per mode (project/archive/2026-09-23-music.md v3: calm 0, alert ~0.5, combat 1; the title cut has none) */
const TENSION: Record<MusicMode, number> = { menu: 0, calm: 0, alert: 0.5, combat: 1 };
const holdAt = (p: AudioParam, t: number) => {
  const cp: { cancelAndHoldAtTime?: (t: number) => void } = p; // Firefox has no cancelAndHoldAtTime
  if (cp.cancelAndHoldAtTime) cp.cancelAndHoldAtTime(t); else { p.cancelScheduledValues(t); p.setValueAtTime(p.value, t); }
};

/** the live game wrapper: timer, state, volume, stings, the stem player, the offline render */
export class Music {
  private readonly scope = resourceScope().child('Music');
  private readonly memoryOwner = resourceScope().name;
  /** ctx + the music bus (`volume` × the Settings 'music' slider → duck → audio.master) + the engine + the stems' bus, built on
   *  first use (play, after the first gesture) so boot never creates the AudioContext; state set before then waits in `pending` */
  private rig: { ctx: AudioContext; out: GainNode; duckGain: GainNode; engine: Engine; stemBus: GainNode } | undefined;
  /** The installed source owns the level's slot; the title is the common menu slot. */
  private pending: MusicState = { mode: 'menu', intensity: 0, underwater: false };
  private timer:Scope|undefined;
  private _volume: number;
  private playing: ArrangementName | undefined;
  private combatTimer: ReturnType<Scope['timeout']> = 0;
  // ── v3: the stems ──
  private readonly _genre: MusicGenre = ENGINE_MUSIC_STYLE;
  /** the resident bank: decoded at the loading bar (useBank), or from the offline cache when the title comes back */
  private bank: StyleBank | undefined;
  private titleRetired = false;
  /** the genre being decoded from the offline cache (the deck plays on meanwhile) */
  private decoding: MusicGenre | undefined;
  private deck: Deck | undefined;
  private readonly resolvingTracks = new WeakSet<AacTrack>();
  /** the synth sequencer is scheduling (its timer runs); `synthGen` voids a pending stop when it is restarted mid-fade */
  private synthOn = false;
  private synthGen = 0;
  /** a style that failed to decode this session: the synth plays in its place */
  private failed = new Set<SlotAudio['genre']>();
  private _duck = 1;
  private source: ScoreSource | undefined;
  /** silent scores asked for before the rig existed (`silence`): applied as `build` makes the music bus */
  private readonly silences = new Set<Scope>();
  private sourceId: string | undefined;

  private audio: Audio;
  constructor(audio: Audio) {
    this.audio = audio;
    this._volume = getNumber('music');
    onNumber('music', (v) => { this._volume = v; if (this.rig) this.rig.out.gain.setTargetAtTime(v, this.rig.ctx.currentTime, 0.05); });
  }

  private build(): NonNullable<Music['rig']> {
    if (this.rig) return this.rig;
    const ctx = this.audio.ctx, out = ctx.createGain(), duckGain = ctx.createGain();
    out.gain.value = this._volume; duckGain.gain.value = this._duck;
    out.connect(duckGain).connect(this.audio.master);
    const engine = new Engine(ctx, out, this.memoryOwner);
    const stemBus = ctx.createGain(); stemBus.connect(engine.bus); // through the engine's low-pass + chorus: underwater muffles the stems too
    this.rig = { ctx, out, duckGain, engine, stemBus };
    for (const scope of this.silences) this.silenceNow(out, scope);
    this.silences.clear();
    this.setState(this.pending);
    return this.rig;
  }
  /**
   * A level's silent score (audio/declared.ts): the music bus at 0 for `scope`'s life, its value before restored on dispose.
   * Before the rig exists it waits for `build` (SF67: building the bus here made the page's AudioContext, ~100 ms of a
   * loading task at 4× CPU, before any gesture could play it).
   */
  silence(scope: Scope): void {
    if (this.rig) { this.silenceNow(this.rig.out, scope); return; }
    this.silences.add(scope);
    scope.onDispose(() => { this.silences.delete(scope); });
  }
  private silenceNow(out: GainNode, scope: Scope): void {
    if (scope.disposed) return;
    const gain = out.gain, before = gain.value; gain.value = 0;
    scope.onDispose(() => { gain.value = before; });
  }
  /**
   * E155: the score is the page's, the shards' Audio are their own (one AudioContext): the music bus follows the running
   * shard into its master — its volume, its mute, its underwater low-pass — and nothing else about the music changes.
   */
  attach(audio: Audio): void {
    if (audio === this.audio) return;
    this.audio = audio;
    if (!this.rig) return;
    this.rig.duckGain.disconnect();
    this.rig.duckGain.connect(audio.master);
  }
  get ctx(): AudioContext { return this.build().ctx; }
  get engine(): Engine { return this.build().engine; }
  get out(): GainNode { return this.build().out; }

  get state(): MusicState { return this.rig ? this.rig.engine.state : this.pending; }
  get stats(): Engine['stats'] { return this.engine.stats; }
  get volume(): number { return this._volume; }
  set volume(v: number) { setNumber('music', v); }
  /** playing, or queued for the first gesture (G325) */
  get isPlaying(): boolean { return this.playing !== undefined || this.queued !== undefined; }
  get genre(): MusicGenre { return this._genre; }
  /** diagnostics (dev / headless checks): what is sounding, the tension stem's live gain, what was fetched and how long it took */
  get stems(): { style: MusicGenre; source: 'synth' | 'stems'; slot: SlotName | undefined; tension: number | undefined; synthOn: boolean; synthMix: number | undefined; duck: number | undefined; loads: { file: string; bytes: number; ms: number }[]; failed: string[]; scene: string; phase: BossPhase; layers: number[] } {
    return {
      style: this._genre, source: this.deck ? 'stems' : 'synth', slot: this.deck?.slot, tension: this.deck?.tensionGain?.gain.value,
      synthOn: this.synthOn, synthMix: this.rig?.engine.synthMix.gain.value, duck: this.rig?.duckGain.gain.value,
      loads: this.bank ? [...this.bank.log] : [], failed: [...this.failed, ...(this.source?.failures ?? [])],
      scene: this.source?.sceneName ?? 'day', phase: this.source?.phase ?? 1, layers: this.deck ? this.deck.layerGains.map((g) => g.gain.value) : [],
    };
  }
  /** A plugin owns the score registration; disposing it releases its decks. */
  setScore(id: string, source: ScoreSource): () => void {
    this.source = source; this.sourceId = id;
    this.setState({ lead: source.synthLead ?? 'pluck' }); this.sync();
    return () => {
      if (this.source !== source) return;
      this.source = undefined; this.sourceId = undefined;
      if (this.deck && source.slots.includes(this.deck.slot)) {
        this.deck.fadeOut(this.rig?.ctx.currentTime ?? 0, 0.05); this.deck = undefined;
      }
    };
  }
  residentBank(): StyleBank | undefined { return this.bank; }
  get scoreId(): string | undefined { return this.sourceId; }
  refreshScore(): void { this.sync(); }
  private scoreSource(): ScoreSource | undefined {
    return this.source;
  }

  /**
   * Adopt a decoded bank. Its mutable maps stay shared with boot/profile owners so retiring the title releases
   * their reference too. The outgoing Deck alone keeps its recording through the unchanged bar crossfade.
   */
  useBank(bank: StyleBank): void {
    if (bank.genre !== this._genre) return;
    const old = this.bank;
    if (old?.genre === bank.genre && old.set === bank.set) {
      for (const [slot, audio] of bank.slots) {
        const previous = old.slots.get(slot);
        if (previous?.tension === undefined && previous && audio.tension !== undefined) {
          previous.tension = audio.tension;
          if (this.deck?.audio === previous) void this.completeTension(this.deck, audio.tension);
        }
        bank.slots.set(slot, previous ?? audio);
      }
      for (const [sting, audio] of bank.stings) bank.stings.set(sting, old.stings.get(sting) ?? audio);
    }
    if (old !== bank) old?.slots.delete('title');
    this.bank = bank;
    if (bank.slots.has('title')) this.titleRetired = false;
    this.retireTitle();
    this.sync();
  }
  private async completeTension(deck: Deck, stem: AudioBuffer | AacTrack): Promise<void> {
    try { await deck.completeTension(stem); }
    catch (error: unknown) { console.info('[music] late tension preparation failed', error); }
  }
  private retireTitle(): void {
    if (this.state.mode !== 'menu' && this.bank?.slots.delete('title')) this.titleRetired = true;
  }

  /** start an arrangement (the game uses 'theme'); restarts if already playing. The stems start at once when decoded, else the synth. */
  play(name: ArrangementName = 'theme'): void {
    if (audioUnlocked()) { this.queued?.cancel(); this.queued = undefined; this.start(name); return; }
    // G325: before the page's first gesture there is no AudioContext; the start waits for that gesture (the last name asked wins)
    if (this.queued !== undefined) { this.queued.name = name; return; }
    const wait: { name: ArrangementName; cancel: () => void } = { name, cancel: () => undefined };
    this.queued = wait;
    wait.cancel = whenAudioUnlocked(() => { if (this.queued !== wait) return; this.queued = undefined; this.start(wait.name); }).cancel;
  }
  /** the music start a `play` before the first gesture is waiting for (G325) */
  private queued: { name: ArrangementName; cancel: () => void } | undefined;
  private start(name: ArrangementName): void {
    const t = this.ctx.currentTime + 0.05;
    if (this.playing) { this.stopTimer(); this.synthOn = false; this.engine.end(t); this.deck?.fadeOut(t, 0.05); this.deck = undefined; }
    this.playing = name;
    if (name === 'theme' && this.stemsReady()) { this.sync(); return; } // the decoded deck from silence — no synth bridge
    this.startSynth(t, 0);
    const arr = arrangementOf(name);
    const warm = (): void => {
      if (!this.scope.disposed && !this.scope.disposing) this.engine.warm(arr);
    };
    const w: { requestIdleCallback?: (run: () => void) => number; cancelIdleCallback?: (id: number) => void } = window;
    const request=w.requestIdleCallback;
    if (request !== undefined) audioIdle(this.scope,this.ctx,{
      request:run=>request.call(window,run),cancel:id=>{w.cancelIdleCallback?.(id);},
    },warm);
    else audioTimeout(this.scope,this.ctx,300,warm);
    if (name === 'theme') this.sync();
  }
  private stemsReady(): boolean {
    // Pine Hollow's night / boss live in their own set: the base bank must hold the theme they fall back to
    const b = this.bank, slot = this.source ? this.baseSlot() : this.wantSlot();
    return b !== undefined && b.genre === this._genre && slot !== null && b.slots.has(slot);
  }
  private pump() {
    const spb = this.engine.currentSpb();
    this.engine.pump(this.ctx.currentTime + LOOKAHEAD_BARS * 4 * spb);
  }
  private stopTimer() { this.timer?.dispose();this.timer=undefined; }

  /** the synth sequencer on (from the top of the arrangement if it was off), its share of the bus up over `fade` from `t` */
  private startSynth(t: number, fade: number): void {
    const e = this.engine, g = e.synthMix.gain;
    this.synthGen++; // voids a stop still pending from a fade-out
    if (!this.synthOn) {
      e.seq.gain.cancelScheduledValues(t); e.seq.gain.setValueAtTime(1, t);
      e.begin(arrangementOf(this.playing ?? 'theme'), t);
      this.synthOn = true;
      this.timer = audioInterval(this.scope,this.ctx,TICK_MS, () => { ambientTick('music.pump', () => { this.pump(); }); }); // the page's score: never a shard's interval (src/shared/engine/app/ownership.ts)
      g.cancelScheduledValues(t); g.setValueAtTime(fade > 0 ? 0 : 1, t);
    } else holdAt(g, t);
    if (fade > 0) g.linearRampToValueAtTime(1, t + fade);
  }
  /** the synth's share down over `fade` from `t`, then its scheduler stops (no CPU while the stems play) */
  private stopSynth(t: number, fade: number): void {
    if (!this.synthOn) return;
    const g = this.engine.synthMix.gain;
    holdAt(g, t); g.linearRampToValueAtTime(0, t + fade);
    const gen = ++this.synthGen;
    audioTimeout(this.scope,this.ctx,Math.max(0, t + fade - this.ctx.currentTime) * 1000 + 150, () => {
      if (gen !== this.synthGen || !this.synthOn) return; // restarted meanwhile
      this.stopTimer(); this.synthOn = false; this.engine.end(this.ctx.currentTime);
    });
  }

  // ─────────────── the stems (project/archive/2026-09-23-music.md v3 row 7) ───────────────
  /** the slot the state asks for: the title cut on the menu, else the shard's theme; null = no stems for this shard yet —
   *  a level with its own score plays the synth theme's plucked lead until that score lands, never another level's stems (F6) */
  private wantSlot(): SlotName | null {
    const s = this.state;
    if (s.mode !== 'menu' && this.scoreSource()) return this.scoreSource()?.target(s) ?? null;
    return this.baseSlot();
  }
  /** the slot of the base set: the title on the menu, else the source's base slot */
  private baseSlot(): SlotName | null {
    const s = this.state;
    return s.mode === 'menu' ? 'title' : this.source?.base ?? null;
  }
  private tension(): number { return TENSION[this.state.mode]; }

  /** bring what plays in line with the genre + state: hand over to / from the synth, switch decks, move the tension stem */
  private sync(): void {
    if (!this.rig || !this.playing) return;
    const now = this.rig.ctx.currentTime, genre = this._genre;
    const source = this.state.mode !== 'menu' ? this.scoreSource() : undefined;
    if ((this.failed.has(genre) && source?.styleIndependent !== true) || this.wantSlot() === null) { this.toSynth(now); return; }
    this.deck?.setTension(this.tension(), now); // a deck of another slot / genre plays on (at the right level) until the new one is in
    if (source) {
      const playing = this.deck && source.slots.includes(this.deck.slot) ? this.deck.slot : undefined;
      const a = source.want(playing);
      if (a === undefined) { if (!source.pending || !this.deck) this.toSynth(now); return; }
      if (this.deck?.slot === a.slot && this.deck.genre === a.genre) { this.deck.setPhase(source.phase ?? 1, now); return; }
      this.startDeck(a, playing === undefined ? 0 : source.minFade ?? 6);
      return;
    }
    const bank = this.bank;
    if (bank?.genre !== genre) { this.prepare(genre); if (!this.deck && !this.synthOn) this.startSynth(now + 0.05, 1); return; }
    const slot = this.wantSlot();
    if (slot === null) { this.toSynth(now); return; }
    if (this.deck?.slot === slot && this.deck.genre === genre) return;
    // Keep the current deck on its bar grid while a returning menu reloads its retired recording.
    if (slot === 'title' && this.titleRetired) { this.prepare(genre); return; }
    const a = bank.slots.get(slot);
    if (a === undefined) { this.toSynth(now); return; } // this genre has no such slot in the build (or it failed to decode)
    this.startDeck(a);
  }
  /** decode `genre`'s title from the offline cache (the bar already downloaded it) — the deck plays on */
  private prepare(genre: MusicGenre): void {
    if ((this.bank?.genre === genre && !this.titleRetired) || this.decoding === genre || this.failed.has(genre)) return;
    this.decoding = genre;
    void this.decodeFor(genre);
  }
  private async decodeFor(genre: MusicGenre): Promise<void> {
    let bank: StyleBank;
    try { bank = await trackBusy('music', decodeStyle(genre, ['title'], cachedBytes, decodeBytes)); }
    catch (err: unknown) {
      this.failed.add(genre);
      console.info(`[music] ${genre}: ${err instanceof Error ? err.message : String(err)} — the synth plays on`);
      this.sync();
      return;
    } finally { if (this.decoding === genre) this.decoding = undefined; }
    this.titleRetired = false; // A missing/malformed title is one completed attempt, not an endless reload.
    this.useBank(bank); // A late menu decode must not retain the title after gameplay starts.
  }

  /** a decoded slot takes over on a bar: from the synth (its bar grid) or from the other deck (that deck's grid), faded over ≥ 1 bar */
  private async resolveTrack(a: SlotAudio, track: AacTrack, original: boolean): Promise<void> {
    try {
      const buffer = original ? await track.decoded() : undefined;
      if (!original) await track.prime(this.scope);
      if (this.scope.disposed) return;
      if (buffer) {
        if (a.calm === track) a.calm = buffer;
        if (a.tension === track) a.tension = buffer;
      }
      if (this.playing && this._genre === a.genre && this.wantSlot() === a.slot) this.sync();
    } catch (error: unknown) {
      if (this.scope.disposed) return;
      this.failed.add(a.genre);
      console.info(`[music] ${a.genre}/${a.slot}: ${String(error)} — the synth plays on`);
      this.sync();
    } finally { this.resolvingTracks.delete(track); }
  }
  private startDeck(a: SlotAudio, minFade = 0): void {
    const rig = this.rig;
    if (!rig) return;
    // The device context is created only by a gesture. Unsupported rates keep the original decoder;
    // the old deck continues while that fallback resolves, and stale completion cannot install a slot.
    const waiting = [a.calm, a.tension].filter((track): track is AacTrack => track instanceof AacTrack
      && (rig.ctx.sampleRate !== track.sampleRate || !track.ready));
    if (waiting.length > 0) {
      for (const track of waiting) {
        if (this.resolvingTracks.has(track)) continue;
        this.resolvingTracks.add(track);
        void this.resolveTrack(a, track, rig.ctx.sampleRate !== track.sampleRate);
      }
      if (!this.deck && !this.synthOn) this.startSynth(rig.ctx.currentTime + .05, 1);
      return;
    }
    const now = rig.ctx.currentTime, old = this.deck;
    const bar = (60 / a.spec.bpm) * a.spec.beatsPerBar;
    let t: number, fade: number;
    if (old) {
      t = old.nextBar(now + 0.05); fade = Math.max(bar, old.bar, 2, minFade);
      old.fadeOut(t, fade);
    } else if (this.synthOn) {
      t = Math.max(now + 0.05, this.engine.nextBarAfter(now + 0.05)); fade = Math.max(bar, 2);
    } else {
      t = now + 0.05; fade = 1; // from silence (play() with the stems already decoded)
    }
    const deck = withOwner(this.scope, () => new Deck(rig.ctx, a, rig.stemBus, t, fade, this.tension(), this.source?.phase ?? 1, error => {
      console.info(`[music] ${a.genre}/${a.slot}: ${String(error)} — the synth plays on`);
      if (this.deck === deck) { this.deck = undefined; this.failed.add(a.genre); this.sync(); }
    }));
    this.deck = deck;
    audioLog('music', `deck:${a.slot}`, true, a.genre);
    this.stopSynth(t, fade);
    this.source?.onDeck?.(a.slot);
  }

  /** the deck (if any) out over a bar on its grid, the synth back in under it */
  private toSynth(now: number): void {
    const d = this.deck;
    if (!d) { if (!this.synthOn && this.playing) this.startSynth(now + 0.05, 1); return; }
    const t = d.nextBar(now + 0.05), fade = Math.max(d.bar, 2);
    d.fadeOut(t, fade); this.deck = undefined;
    this.startSynth(t, fade);
  }

  /** fade over a bar and silence every voice */
  stop(): void {
    this.queued?.cancel(); this.queued = undefined;
    if (!this.playing) return;
    const t = this.ctx.currentTime;
    if (this.synthOn) {
      this.stopTimer(); this.synthOn = false; this.synthGen++;
      const bar = this.engine.currentSpb() * 4, g = this.engine.seq.gain;
      g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(0, t + bar);
      this.engine.end(t + bar);
    }
    if (this.deck) { this.deck.fadeOut(t, this.deck.bar); this.deck = undefined; }
    this.playing = undefined;
  }

  /** the game → the music: mode/lead/intensity take effect on the next bar (pending bars are rescheduled); underwater is immediate */
  setState(next: Partial<MusicState>): void {
    if (!this.rig) { Object.assign(this.pending, next); this.pending.intensity = Math.min(1, Math.max(0, this.pending.intensity)); this.retireTitle(); return; }
    const s = this.rig.engine.state, prev = { ...s };
    Object.assign(s, next);
    s.intensity = Math.min(1, Math.max(0, s.intensity));
    this.retireTitle();
    const now = this.ctx.currentTime;
    if (s.underwater !== prev.underwater && !this.engine.arrangement?.driven) {
      this.engine.setLevel('lpf', s.underwater ? 600 : 20000, now, s.underwater ? 0.35 : 0.5);
      this.engine.setLevel('chorus', s.underwater ? 0.55 : 0, now, 0.6);
    }
    if (s.mode !== prev.mode) audioLog('music', `mode:${s.mode}`);
    if (this.playing && (s.mode !== prev.mode || s.lead !== prev.lead || s.intensity !== prev.intensity)) {
      if (this.synthOn) { this.engine.cancelPending(now); this.pump(); }
      this.sync();
    }
  }
  /** a combat event (a charge, a hit landed or taken): combat now, decaying to alert 8 s after the last one */
  combat(intensity = 0.7): void {
    this.setState({ mode: 'combat', intensity: Math.max(this.state.intensity, intensity) });
    this.scope.cancelTimer(this.combatTimer);
    this.combatTimer = this.scope.timeout(8000, () => { if (this.state.mode === 'combat') this.setState({ mode: 'alert', intensity: 0.5 }); });
  }

  /** the genre's sting file while its stems play, else the synth sting; the death sting ducks the stems like the synth (a bar down, 6 s out, a bar back) */
  sting(name: StingName): void {
    tap.sound?.(`music.sting:${name}`);
    audioLog('music', `sting:${name}`, this.rig !== undefined);
    if (!this.rig) return;
    const { ctx, engine, stemBus } = this.rig, t = ctx.currentTime + 0.02, deck = this.deck;
    if (name === 'dawn') { this.dawn(); return; }
    const source = this.scoreSource();
    const buf = deck && source?.slots.includes(deck.slot) ? source.stings.get(name) : deck && this.bank?.genre === deck.genre ? this.bank.stings.get(name) : undefined;
    if (buf) { const src = ownAudioSource(ctx.createBufferSource()); src.buffer = buf; src.connect(engine.stingBus); src.start(t); }
    else engine.sting(name, t);
    if (name === 'death' && deck) {
      const g = stemBus.gain, bar = deck.bar;
      holdAt(g, t); g.linearRampToValueAtTime(0, t + bar); g.setValueAtTime(0, t + bar + 6); g.linearRampToValueAtTime(1, t + bar * 2 + 6);
    }
  }

  /** the quest's reward sting (PH-A1): the dawn take's resolve over the score, which dips under it (a beat down, back over 2 bars
   *  after); the synth's discovery chord when no deck plays or the file is not in the build / will not decode */
  private dawn(): void {
    const genre = this._genre;
    if (!this.rig) return;
    if (!this.deck) { this.rig.engine.sting('dawn', this.rig.ctx.currentTime + 0.02); return; }
    void (async () => {
      const buf = await this.source?.sting?.('dawn');
      if (!this.rig) return;
      const { ctx, engine, stemBus } = this.rig, t = ctx.currentTime + 0.02;
      audioLog('music', 'sting:dawn-take', buf !== undefined, buf ? genre : 'synth chord');
      if (!buf) { engine.sting('dawn', t); return; }
      const src = ownAudioSource(ctx.createBufferSource()); src.buffer = buf; src.connect(engine.stingBus); src.start(t);
      const d = this.deck, beat = d ? d.bar / 4 : 0.5, g = stemBus.gain;
      holdAt(g, t); g.linearRampToValueAtTime(0.25, t + beat); g.setValueAtTime(0.25, t + buf.duration - 1); g.linearRampToValueAtTime(1, t + buf.duration - 1 + (d ? d.bar * 2 : 4));
    })();
  }

  /** scale the whole music bus (1 = untouched): the shrine ducks it −3 dB up close. Cheap to call per frame — only a real change schedules. */
  duck(k: number): void {
    const v = Math.min(1, Math.max(0, k));
    if (Math.abs(v - this._duck) < 0.004) return;
    this._duck = v;
    if (this.rig) this.rig.duckGain.gain.setTargetAtTime(v, this.rig.ctx.currentTime, 0.25);
  }

  /** the same instruments and scheduler on an OfflineAudioContext (48 kHz stereo) → an AudioBuffer of `seconds` */
  static async renderOffline(name: ArrangementName, seconds: number, opts: { state?: Partial<MusicState> | undefined; solo?: string[] | undefined } = {}): Promise<AudioBuffer> {
    const sr = 48000, off = new OfflineAudioContext(2, Math.ceil(sr * seconds), sr);
    // the same master chain the live mix goes through (Audio.ts): a gentle compressor before the output
    const comp = off.createDynamicsCompressor();
    comp.threshold.value = -12; comp.knee.value = 18; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.16;
    comp.connect(off.destination);
    const eng = new Engine(off, comp, resourceScope().name);
    if (opts.state) Object.assign(eng.state, opts.state);
    if (opts.solo) eng.solo = new Set(opts.solo);
    eng.begin(arrangementOf(name), 0);
    eng.pump(seconds);
    // a final fade so a loop render never ends on a click
    eng.bus.gain.setValueAtTime(1, Math.max(0, seconds - 0.6)); eng.bus.gain.linearRampToValueAtTime(0, seconds - 0.02);
    const buf = await off.startRendering();
    // the file's ceiling: if the densest bar pokes above −1.5 dBFS, trim the whole render to it (a few tenths of a dB at most)
    let peak = 0;
    for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c); for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i] ?? 0)); }
    const ceil = 10 ** (-1.5 / 20);
    if (peak > ceil) for (let c = 0; c < buf.numberOfChannels; c++) { const d = buf.getChannelData(c), k = ceil / peak; for (let i = 0; i < d.length; i++) d[i] = (d[i] ?? 0) * k; }
    return buf;
  }
  renderOffline(name: ArrangementName, seconds: number, opts?: { state?: Partial<MusicState> | undefined; solo?: string[] | undefined }): Promise<AudioBuffer> { return Music.renderOffline(name, seconds, opts); }

  /** Native WAV bytes (16-bit PCM) of an offline AudioBuffer. */
  static toWav(buf: AudioBuffer): ArrayBuffer {
    const ch = buf.numberOfChannels, n = buf.length, sr = buf.sampleRate, bytes = 44 + n * ch * 2;
    const ab = new ArrayBuffer(bytes), dv = new DataView(ab);
    const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.codePointAt(i) ?? 0); };
    str(0, 'RIFF'); dv.setUint32(4, bytes - 8, true); str(8, 'WAVE'); str(12, 'fmt '); dv.setUint32(16, 16, true);
    dv.setUint16(20, 1, true); dv.setUint16(22, ch, true); dv.setUint32(24, sr, true); dv.setUint32(28, sr * ch * 2, true); dv.setUint16(32, ch * 2, true); dv.setUint16(34, 16, true);
    str(36, 'data'); dv.setUint32(40, n * ch * 2, true);
    const chans = Array.from({ length: ch }, (_, i) => buf.getChannelData(i));
    let o = 44;
    for (let i = 0; i < n; i++) for (const chan of chans) { const v = Math.max(-1, Math.min(1, chan[i] ?? 0)); dv.setInt16(o, v < 0 ? v * 32768 : v * 32767, true); o += 2; }
    return ab;
  }
}
