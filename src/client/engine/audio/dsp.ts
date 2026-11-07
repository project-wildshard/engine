/**
 * dsp — a tiny offline DSP kit for the procedural sound bank (src/client/engine/audio/gen.ts). Pure TypeScript on Float32Arrays:
 * no WebAudio, no DOM, so every generator runs (and is tested) in node exactly as it runs in the browser.
 *
 *   const r = new Rand(seed);                 // deterministic noise (xorshift32)
 *   const f = new Biquad('bandpass', 1200, 2, sr); y = f.run(x); f.set('bandpass', 900, 2);   // RBJ cookbook, TDF-II
 *   const m = new Modes(sr, [[180, 0.08, 1], [420, 0.05, 0.6]]); m.strike(1); y = m.run();      // modal resonator bank
 *   const g = new Glottis(sr, rand); g.run(f0, tenseness);   // a band-limited glottal pulse train with jitter (vocals)
 *   normalize(buf, 0.9); fade(buf, sr, 0.002, 0.03)
 */

export type FilterType = 'lowpass' | 'highpass' | 'bandpass' | 'peaking' | 'notch';

/** xorshift32: fast, deterministic, good enough for audio noise */
export class Rand {
  private s: number;
  constructor(seed: number) { this.s = (seed | 0) || 0x9e3779b9; }
  /** [0, 1) */
  next(): number {
    let x = this.s;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.s = x;
    return (x >>> 0) / 4294967296;
  }
  /** [-1, 1) */
  bi(): number { return this.next() * 2 - 1; }
  range(a: number, b: number): number { return a + this.next() * (b - a); }
  /** ≈ gaussian (sum of 4 uniforms) */
  gauss(): number { return (this.next() + this.next() + this.next() + this.next() - 2) * 1.732; }
}

/** RBJ biquad, transposed direct form II; `set` recomputes the coefficients (cheap enough every 16–32 samples for sweeps) */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private z1 = 0; private z2 = 0;
  private readonly sr: number;
  constructor(type: FilterType, freq: number, q: number, sr: number, gainDb = 0) { this.sr = sr; this.set(type, freq, q, gainDb); }
  set(type: FilterType, freq: number, q: number, gainDb = 0): this {
    const f = Math.min(Math.max(freq, 5), this.sr * 0.49);
    const w = (2 * Math.PI * f) / this.sr, cw = Math.cos(w), sw = Math.sin(w), alpha = sw / (2 * Math.max(q, 0.05));
    // [b0, b1, b2, a0] per type; a1 = −2 cos w and a2 = 1 − α for all but the peaking EQ
    let b0 = alpha, b1 = 0, b2 = -alpha, a0 = 1 + alpha, a2 = 1 - alpha; // bandpass (constant 0 dB peak)
    const a1 = -2 * cw;
    if (type === 'lowpass') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
    else if (type === 'highpass') { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
    else if (type === 'notch') { b0 = 1; b1 = -2 * cw; b2 = 1; }
    else if (type === 'peaking') {
      const A = 10 ** (gainDb / 40);
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a2 = 1 - alpha / A;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
  /** filter a whole buffer in place */
  apply(buf: Float32Array): Float32Array { for (let i = 0; i < buf.length; i++) buf[i] = this.run(buf[i] ?? 0); return buf; }
}

/** Paul Kellet's economy pink filter over white noise */
export class Pink {
  private b0 = 0; private b1 = 0; private b2 = 0;
  private readonly r: Rand;
  constructor(r: Rand) { this.r = r; }
  next(): number {
    const w = this.r.bi();
    this.b0 = 0.99765 * this.b0 + w * 0.099046;
    this.b1 = 0.963 * this.b1 + w * 0.2965164;
    this.b2 = 0.57 * this.b2 + w * 1.0526913;
    return (this.b0 + this.b1 + this.b2 + w * 0.1848) * 0.25;
  }
}

/** a bank of exponentially decaying sinusoids (modal synthesis): [freq Hz, T60-ish decay s, amplitude] per mode */
export class Modes {
  private re: Float64Array; private im: Float64Array; private cr: Float64Array; private ci: Float64Array; private amp: Float64Array;
  constructor(sr: number, modes: readonly (readonly [number, number, number])[]) {
    const n = modes.length;
    this.re = new Float64Array(n); this.im = new Float64Array(n); this.cr = new Float64Array(n); this.ci = new Float64Array(n); this.amp = new Float64Array(n);
    modes.forEach(([f, decay, a], i) => {
      const r = Math.exp(-6.9 / (Math.max(decay, 0.002) * sr)); // −60 dB after `decay` s
      const w = (2 * Math.PI * Math.min(f, sr * 0.45)) / sr;
      this.cr[i] = r * Math.cos(w); this.ci[i] = r * Math.sin(w); this.amp[i] = a;
    });
  }
  /** add energy to every mode: `hard` starts each mode at its peak (cosine phase — the knock of a hard hit), else in sine phase (a soft, click-free onset) */
  strike(v: number, hard = true): void {
    for (let i = 0; i < this.re.length; i++) {
      const a = v * (this.amp[i] ?? 0);
      if (hard) this.im[i] = (this.im[i] ?? 0) + a; else this.re[i] = (this.re[i] ?? 0) - a;
    }
  }
  run(): number {
    let s = 0;
    for (let i = 0; i < this.re.length; i++) {
      const re = this.re[i] ?? 0, im = this.im[i] ?? 0, cr = this.cr[i] ?? 0, ci = this.ci[i] ?? 0;
      this.re[i] = re * cr - im * ci; this.im[i] = re * ci + im * cr;
      s += this.im[i] ?? 0;
    }
    return s;
  }
}

/**
 * A glottal source for creature / human vocals: a Rosenberg-style pulse per period (open phase rise, fast close) with
 * cycle-to-cycle jitter + shimmer and aspiration noise; `tense` 0 breathy … 1 pressed (shorter open phase, brighter).
 * Call `run(f0, tense)` once per sample; f0 may glide freely.
 */
export class Glottis {
  private ph = 0; private per = 1; private amp = 1;
  private readonly sr: number;
  private readonly r: Rand;
  private readonly jitter: number;
  private readonly shimmer: number;
  constructor(sr: number, r: Rand, jitter = 0.02, shimmer = 0.08) { this.sr = sr; this.r = r; this.jitter = jitter; this.shimmer = shimmer; }
  run(f0: number, tense: number, breath = 0.08): number {
    this.ph += f0 / this.sr * this.per;
    if (this.ph >= 1) { this.ph -= 1; this.per = 1 + this.r.gauss() * this.jitter; this.amp = 1 + this.r.gauss() * this.shimmer; }
    const open = 0.75 - 0.35 * tense, p = this.ph;
    let g: number;
    if (p < open * 0.65) { const u = p / (open * 0.65); g = 0.5 - 0.5 * Math.cos(Math.PI * u); }
    else if (p < open) { const u = (p - open * 0.65) / (open * 0.35); g = Math.cos(u * Math.PI * 0.5); }
    else g = 0;
    // centred (the formant band-passes drop what DC is left), plus aspiration noise gated by the open phase
    return (g - 0.45) * this.amp + this.r.bi() * breath * (0.3 + g);
  }
}

/** a parallel formant filter (vowel): [freq, bandwidth-Q, gain] */
export class Formants {
  private f: Biquad[];
  private spec: [number, number, number][];
  constructor(sr: number, spec: [number, number, number][]) { this.spec = spec; this.f = spec.map(([fr, q]) => new Biquad('bandpass', fr, q, sr)); }
  /** morph the formant frequencies (call every ~32 samples) */
  set(spec: [number, number, number][]): void { this.spec = spec; spec.forEach(([fr, q], i) => { this.f[i]?.set('bandpass', fr, q); }); }
  run(x: number): number { let y = 0; for (let i = 0; i < this.f.length; i++) y += (this.f[i]?.run(x) ?? 0) * (this.spec[i]?.[2] ?? 0); return y; }
}

// ─────────────── buffer utilities ───────────────
export const len = (sec: number, sr: number): number => Math.max(1, Math.round(sec * sr));
export function normalize(buf: Float32Array, peak = 0.9): Float32Array {
  let m = 0; for (let i = 0; i < buf.length; i++) m = Math.max(m, Math.abs(buf[i] ?? 0));
  if (m > 1e-9) { const k = peak / m; for (let i = 0; i < buf.length; i++) buf[i] = (buf[i] ?? 0) * k; }
  return buf;
}
/** linear fade-in / raised-cosine fade-out, so nothing clicks at either end */
export function fade(buf: Float32Array, sr: number, inS: number, outS: number): Float32Array {
  const a = Math.min(buf.length, len(inS, sr)), b = Math.min(buf.length, len(outS, sr));
  for (let i = 0; i < a; i++) buf[i] = (buf[i] ?? 0) * (i / a);
  for (let i = 0; i < b; i++) { const j = buf.length - 1 - i; buf[j] = (buf[j] ?? 0) * (0.5 - 0.5 * Math.cos((Math.PI * i) / b)); }
  return buf;
}
/** gentle tanh saturation (glues layers, rounds transients) */
export function saturate(buf: Float32Array, drive = 1.5): Float32Array {
  const k = Math.tanh(drive);
  for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh((buf[i] ?? 0) * drive) / k;
  return buf;
}
/** attack-then-exponential-decay envelope value at t (s) */
export const ad = (t: number, attack: number, decay: number): number => (t < 0 ? 0 : t < attack ? t / attack : Math.exp(-(t - attack) / decay));
