import { resourceScope } from '../../../shared/engine/app/resources';
import { withOwner } from '../../../shared/engine/app/ownership';
import { ownAudioSource } from './ownership';
import { tap } from '../../../shared/engine/core/harnessTap';
import { AacTrack } from './aacTrack';
import { AacSource } from './aacSource';
// src/client/engine/audio/Stems.ts — the MiniMax-Music3 stem player behind src/client/engine/audio/Music.ts (project/archive/2026-09-23-music.md v3, row 7).
//
//   public/assets/music/<genre>/music.json   { genre, model, credit, slots: { <slot>: { calm, tension, bpm, beatsPerBar,
//                                            loopStart, loopEnd, duration }, title: { full, … } }, stings: { pickup, death, chunk } }
//
// A *deck* is one slot playing: the calm stem (melody / harmony + soft bass) always, the tension stem (drums + bass, the same
// recording split by demucs, so sample-aligned) under its own gain, both AudioBufferSourceNodes started at the same context
// time and looping loopStart → loopEnd. The loop is a whole number of bars, so the bar grid is continuous in context time:
// bar k starts at t0 + loopStart + k · bar. Every gain move (tension, crossfades) lands on that grid.
//
// Nothing here fetches: the manifests are compiled into the bundle (src/client/game/boot/audio.generated.ts) and the files are read by the
// caller — the boot's counted fetch at the loading bar, or Cache Storage for a genre switch (project/archive/2026-09-23-preload-offline.md).
// `decodeStyle` decodes one genre's slots + stings; a slot whose file is missing or will not decode is left out, and Music
// keeps the synth for it.
//
// A level's own set (`stems.py --set <set>`): public/assets/music/<set>-<genre>/music.json — the same manifest; a boss slot
// carries `layers` (bass, drums) and `phases` (each boss phase's layer gains). `decodeStyle(genre, slots, …, set)` reads it.
// A deck of the boss plays its layers at the current phase's gains (Deck.setPhase), moved on the bar like the tension stem.

import { STINGS, musicManifest, musicSetDir, shipped, type MusicStyle as MusicGenre, type BossPhase, type MusicSet, type SlotName, type SlotSpec, type StemSting } from '../../../shared/engine/audio/bootAudio';

/** a decoded slot: its spec and the stems (tension absent for the title cut; layers only on the boss) */
export interface SlotAudio { genre: MusicGenre; slot: SlotName; spec: SlotSpec; calm: AudioBuffer | AacTrack; tension: AudioBuffer | AacTrack | undefined; layers: AudioBuffer[] }

/** one genre, decoded: the slots this shard can play and the stings, plus what each file cost */
export type StyleBank = GenreBank;
export interface GenreBank {
  genre: MusicGenre;
  set: MusicSet;
  slots: Map<SlotName, SlotAudio>;
  stings: Map<StemSting, AudioBuffer>;
  /** diagnostics: read → decoded wall time per file, and its bytes */
  log: { file: string; bytes: number; ms: number }[];
}

/**
 * Decode `slots` + every sting of `genre`. `read` hands over a file's bytes (by URL), `decode` turns them into an AudioBuffer
 * (an OfflineAudioContext's — no live context needed). Rejects only when the build has no manifest for the genre.
 */
export async function decodeStyle(genre: MusicGenre, slots: readonly SlotName[], read: (url: string) => Promise<ArrayBuffer>, decode: (bytes: ArrayBuffer) => Promise<AudioBuffer>, onFile?: () => void, set: MusicSet = 'base', stings: readonly StemSting[] = STINGS, withTension = true): Promise<StyleBank> {
  const m = musicManifest(genre, set);
  if (!m) throw new Error(`no music.json for '${musicSetDir(genre, set)}' in this build`);
  const base = `/assets/music/${musicSetDir(genre, set)}/`;
  const bank: StyleBank = { genre, set, slots: new Map(), stings: new Map(), log: [] };
  const owner = resourceScope();
  const readOne = async <T>(file: string, convert: (bytes: ArrayBuffer) => Promise<T>): Promise<T> => {
    const t = performance.now(), url = `${base}${file}`;
    try {
      if (!shipped(url)) throw new Error(`${url} is not in this build`);
      const bytes = await read(url), size = bytes.byteLength; // decodeAudioData detaches the buffer
      const buf = await convert(bytes);
      bank.log.push({ file, bytes: size, ms: Math.round(performance.now() - t) });
      return buf;
    } finally { onFile?.(); }
  };
  const one = (file: string): Promise<AudioBuffer> => readOne(file, decode);
  await Promise.all([
    ...slots.map(async (slot) => {
      const spec = m.slots[slot];
      if (!spec) return;
      try {
        const bounded = spec.layers.length === 0;
        const stem = (file: string): Promise<AudioBuffer | AacTrack> => bounded ? readOne(file, async bytes => {
          const prepared = await AacTrack.prepare(new Uint8Array(bytes), spec.loopStart, spec.loopEnd, decode, undefined, owner);
          if (owner.disposed) throw new Error('Music preparation owner retired');
          return prepared ?? await decode(bytes);
        }) : one(file);
        const [calm, tension, ...layers] = await Promise.all([stem(spec.calm), !withTension || spec.tension === undefined ? Promise.resolve(undefined) : stem(spec.tension), ...spec.layers.map(one)]);
        // the loop must fit the file (a bad loopEnd would loop into silence)
        if (spec.loopEnd > calm.duration + 0.05) throw new Error(`${slot}: loopEnd ${spec.loopEnd} past the file (${calm.duration.toFixed(2)} s)`);
        // stems of one recording: a stem of another length would drift off the calm one — drop it rather than play it wrong
        const aligned = (b: AudioBuffer | AacTrack | undefined): b is AudioBuffer | AacTrack => b !== undefined && Math.abs(b.duration - calm.duration) < 0.05;
        if (!layers.every(aligned)) throw new Error(`${slot}: a layer's length differs from the base`);
        bank.slots.set(slot, { genre, slot, spec, calm, tension: aligned(tension) ? tension : undefined, layers });
      } catch (err: unknown) { console.info(`[music] ${genre}/${slot}: ${err instanceof Error ? err.message : String(err)} — the synth plays it`); }
    }),
    ...stings.map(async (k) => {
      const f = m.stings[k];
      if (f === undefined) return;
      try { bank.stings.set(k, await one(f)); } catch { /* that sting stays synth */ }
    }),
  ]);
  return bank;
}

/** one slot playing: calm + tension sources (+ the boss's layers) through their gains into `out` (the deck's fade) */
export class Deck {
  private readonly scope = resourceScope().child('Deck');
  readonly out: GainNode;
  private joinedGain: GainNode | undefined;
  get tensionGain(): GainNode | undefined { return this.joinedGain; }
  private joining: Promise<void> | undefined;
  /** the boss's layer gains (bass, drums), set per phase */
  readonly layerGains: GainNode[] = [];
  readonly bar: number;
  private srcs: AudioBufferSourceNode[] = [];
  private streams: AacSource[] = [];
  private tension = 0;
  private _phase: BossPhase = 1;
  stopAt: typeof Infinity = Infinity;

  private heldAudio: SlotAudio | undefined;
  private readonly spec: SlotSpec;
  readonly slot: SlotName;
  readonly genre: MusicGenre;
  readonly t0: number;
  private readonly ctx: BaseAudioContext;
  private readonly failed: ((error: unknown) => void) | undefined;
  constructor(ctx: BaseAudioContext, audio: SlotAudio, dest: AudioNode, t0: number, fadeIn: number, tension = 0, phase: BossPhase = 1, failed?: (error: unknown) => void) {
    if ([audio.calm, audio.tension].some(stem => stem instanceof AacTrack && (ctx.sampleRate !== stem.sampleRate || audio.layers.length > 0))) {
      this.scope.dispose(); throw new Error('Bounded AAC deck requires 48 kHz playback without boss layers');
    }
    this.ctx = ctx;
    this.failed = failed;
    this.heldAudio = audio;
    this.spec = audio.spec;
    this.slot = audio.slot;
    this.genre = audio.genre;
    this.t0 = t0;
    this.tension = tension;
    tap.sound?.(`stems.bed:${audio.slot}`);
    const { spec } = audio;
    this.bar = (60 / spec.bpm) * spec.beatsPerBar;
    this.out = ctx.createGain();
    this.out.gain.setValueAtTime(fadeIn > 0 ? 0 : 1, 0);
    if (fadeIn > 0) { this.out.gain.setValueAtTime(0, t0); this.out.gain.linearRampToValueAtTime(1, t0 + fadeIn); }
    this.out.connect(dest);
    // Registered first: source handles/listeners retire before their PCM references.
    this.scope.onDispose(() => {
      for (const source of this.srcs) source.buffer = null;
      this.srcs = [];
      this.streams = [];
      this.heldAudio = undefined;
      this.out.disconnect();
      this.tensionGain?.disconnect();
      for (const gain of this.layerGains) gain.disconnect();
      this.layerGains.length = 0;
    });
    this.scope.listen(ctx, 'statechange', () => {
      if (this.stopAt !== Infinity && this.pausedClock()) this.dispose();
    });
    const mk = (buf: AudioBuffer | AacTrack, to: AudioNode) => {
      if (buf instanceof AacTrack) {
        try {
          this.streams.push(new AacSource(buf, { context: ctx, output: to, scope: this.scope,
            ended: () => this.dispose(), failed: error => { this.dispose(); failed?.(error); } }, t0));
        } catch (error) { this.scope.dispose(); throw error; }
      } else {
        const s = withOwner(this.scope, () => ownAudioSource(ctx.createBufferSource())); s.buffer = buf; s.loop = true; s.loopStart = spec.loopStart; s.loopEnd = spec.loopEnd;
        s.connect(to); s.start(t0, 0); this.srcs.push(s);
      }
    };
    mk(audio.calm, this.out);
    if (audio.tension) {
      this.tension = tension;
      this.joinedGain = ctx.createGain(); this.joinedGain.gain.value = tension; this.joinedGain.connect(this.out);
      mk(audio.tension, this.joinedGain);
    }
    this._phase = phase;
    const pg = spec.phases[phase] ?? [];
    audio.layers.forEach((buf, i) => {
      const g = ctx.createGain(); g.gain.value = pg[i] ?? 0; g.connect(this.out); this.layerGains.push(g);
      mk(buf, g);
    });
  }
  /** Live decoded stems; retirement releases them, while slot/bar metadata remains readable. */
  get audio(): SlotAudio {
    if (!this.heldAudio) throw new Error('Deck has retired');
    return this.heldAudio;
  }
  /** Stop and release this deck once, including when its context cannot deliver ended. */
  dispose(): void { this.scope.dispose(); }
  private pausedClock(): boolean {
    // Offline contexts accept scheduled crossfades before startRendering, while suspended.
    return this.ctx.state !== 'running' && !('startRendering' in this.ctx);
  }
  get phase(): BossPhase { return this._phase; }

  /** the boss's phase: its layers move to that phase's gains on the next bar (in over a beat, out over two bars) */
  setPhase(phase: BossPhase, now: number): void {
    if (this.scope.disposed) return;
    const want = this.spec.phases[phase];
    if (phase === this._phase || !want || this.layerGains.length === 0) return;
    const tb = this.nextBar(now + 0.02), beat = this.bar / this.spec.beatsPerBar, up = phase > this._phase;
    const before = this.spec.phases[this._phase] ?? [];
    this.layerGains.forEach((g, i) => {
      const cp: { cancelAndHoldAtTime?: (t: number) => void } = g.gain;
      if (cp.cancelAndHoldAtTime) cp.cancelAndHoldAtTime(tb); else { g.gain.cancelScheduledValues(tb); g.gain.setValueAtTime(before[i] ?? 0, tb); }
      g.gain.linearRampToValueAtTime(want[i] ?? 0, tb + (up ? beat : this.bar * 2));
    });
    this._phase = phase;
  }
  get level(): number { return this.tension; }

  /** Add a later admitted stem on this deck's original bar and source-sample
   * clock. The calm source stays live; retirement or a crossfade cancels join. */
  completeTension(stem: AudioBuffer | AacTrack): Promise<void> {
    if (this.joining) return this.joining;
    if (this.joinedGain || this.scope.disposed || this.scope.disposing || this.stopAt !== Infinity) return Promise.resolve();
    const work = this.joinTension(stem).finally(() => { if (this.joining === work) this.joining = undefined; });
    this.joining = work;
    return work;
  }
  private async joinTension(stem: AudioBuffer | AacTrack): Promise<void> {
    const ctx = this.ctx, spec = this.spec;
    if (Math.abs(stem.duration - this.audio.calm.duration) >= .05) throw new Error('Late tension length differs from its calm recording');
    const owner = this.scope.child('Deck.tension');
    try {
      const planned = this.nextBar(ctx.currentTime + .05);
      const elapsed = (planned - this.t0) * 48000;
      const start = Math.round(spec.loopStart * 48000), end = Math.round(spec.loopEnd * 48000);
      const sample = Math.round(elapsed);
      const initial = sample < end ? sample : start + (sample - start) % (end - start);
      const prepared = stem instanceof AacTrack && ctx.sampleRate !== stem.sampleRate ? await stem.decoded() : stem;
      if (prepared instanceof AacTrack) await prepared.primeAt(initial, owner);
      if (owner.disposed || owner.disposing || this.stopAt !== Infinity) { owner.dispose(); return; }
      const at = this.nextBar(ctx.currentTime + .05), gain = ctx.createGain();
      owner.onDispose(() => { gain.disconnect(); });
      gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(this.tension, at + this.bar / spec.beatsPerBar);
      gain.connect(this.out);
      if (prepared instanceof AacTrack) {
        this.streams.push(new AacSource(prepared, { context: ctx, output: gain, scope: owner,
          ended: () => owner.dispose(), failed: error => { this.dispose(); this.failed?.(error); } }, planned, { initial, at }));
      } else {
        const source = withOwner(owner, () => ownAudioSource(ctx.createBufferSource()));
        owner.onDispose(() => { source.buffer = null; });
        source.buffer = prepared; source.loop = true; source.loopStart = spec.loopStart; source.loopEnd = spec.loopEnd;
        const elapsedAt = at - this.t0, offset = elapsedAt < spec.loopEnd ? elapsedAt : spec.loopStart + (elapsedAt - spec.loopStart) % (spec.loopEnd - spec.loopStart);
        source.connect(gain); source.start(at, offset); this.srcs.push(source);
      }
      this.joinedGain = gain;
    } catch (error) { owner.dispose(); throw error; }
  }

  /** the first bar line at or after `t` — bars run from loopStart in file time, and the loop is whole bars, so the grid never breaks */
  nextBar(t: number): number {
    const a = this.t0 + this.spec.loopStart;
    return Math.max(this.t0, a + Math.ceil((t - a) / this.bar - 1e-6) * this.bar);
  }

  /** move the tension layer to `level` on the next bar: in over one beat (it lands on the downbeat), out over two bars */
  setTension(level: number, now: number): void {
    if (this.scope.disposed) return;
    const g = this.tensionGain;
    if (!g) { this.tension = level; return; }
    if (Math.abs(level - this.tension) < 1e-3) return;
    const tb = this.nextBar(now + 0.02), beat = this.bar / this.spec.beatsPerBar;
    const cp: { cancelAndHoldAtTime?: (t: number) => void } = g.gain;
    if (cp.cancelAndHoldAtTime) cp.cancelAndHoldAtTime(tb); else { g.gain.cancelScheduledValues(tb); g.gain.setValueAtTime(this.tension, tb); }
    g.gain.linearRampToValueAtTime(level, tb + (level > this.tension ? beat : this.bar * 2));
    this.tension = level;
  }

  /** fade out over `secs` from `t` and stop the sources after it */
  fadeOut(t: number, secs: number): void {
    if (this.scope.disposed) return;
    const firstFade = this.stopAt === Infinity;
    this.stopAt = t + secs;
    // A paused clock cannot reach the scheduled stop. Retiring it is inaudible.
    if (this.pausedClock()) { this.dispose(); return; }
    const g = this.out.gain;
    const cp: { cancelAndHoldAtTime?: (t: number) => void } = g;
    if (cp.cancelAndHoldAtTime) cp.cancelAndHoldAtTime(t); else { g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); }
    g.linearRampToValueAtTime(0, t + secs);
    for (const s of this.srcs) { try { s.stop(t + secs + 0.05); } catch { /* already stopped */ } }
    if (this.streams.length > 0) { for (const stream of this.streams) stream.stop(t + secs + 0.05); return; }
    const last = this.srcs[0];
    if (last) { if (firstFade) this.scope.listen(last, 'ended', () => this.dispose(), { once: true }); }
    else this.dispose();
  }
}
