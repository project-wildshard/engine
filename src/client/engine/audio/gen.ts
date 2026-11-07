import type { AudioPcmProgram, AudioMixExpr } from '@wildshard/format/audioProfiles';
import { audioMixValue } from '../../../shared/engine/audio/audioProfiles';
/**
 * gen — the procedural sound bank: every one-shot the island needs, synthesised offline into a Float32Array (pure
 * TypeScript, src/client/engine/audio/dsp.ts; no files, no WebAudio). src/client/engine/audio/Voices.ts turns them into AudioBuffers once, after the
 * first gesture, a family per idle slice; the tests (test/audio-gen.test.ts) run the same functions in node.
 *
 * Why offline and not a graph of oscillators per call: a footstep here is a heel + toe of layered grains, modal wood /
 * stone resonances and bubbles — ~200 tiny events that would cost a hundred WebAudio nodes per step. Rendered once, a
 * play is one AudioBufferSourceNode + a gain (and a panner), and ±5 % playback-rate jitter keeps repeats from reading.
 *
 *   footstep(kind, sr, seed)            'sand' | 'wetSand' | 'grass' | 'rock' | 'planks' | 'stone' | 'water'
 *   whoosh(sr, seed, heavy)             a blade through the air (bell-shaped velocity, edge whistle)
 *   impact(material, sr, seed)          'flesh' | 'shell' | 'wood' | 'stone' — transient + material body
 *   hurt(sr, seed) · death(sr, seed)    the player (formant vocal over a body hit)
 *   plunge(sr, seed, up)                crossing the water surface (down: a plunge + bubble cloud; up: sheeting water)
 *   bubbleBed(sr, seed)                 a seamless 6 s loop of underwater bubbles + pressure rumble
 *   impulse(room, sr, seed)             [L, R] impulse responses: 'hold' 0.6 s · 'cave' 1.5 s · 'shrine' 2.5 s; Pine Hollow (PH-A5):
 *                                       'cabin' 0.5 s · 'den' 1.8 s · 'oldgrowth' 1.4 s · 'bowl' 0.9 s
 *   noiseLoop(sr, seed, pink)           a seamless 4 s white / pink noise loop (the ambience beds' raw material)
 *   interact(kind, sr, seed)            the adventure kit: chest / locked / lever / plate / door / grate / chime / glyph / ignite
 */
import { Biquad, Formants, Glottis, Modes, Pink, Rand, ad, fade, len, normalize, saturate, type FilterType } from './dsp';

export type StepKind = 'sand' | 'wetSand' | 'grass' | 'rock' | 'planks' | 'stone' | 'water';
export type Material = 'flesh' | 'shell' | 'wood' | 'stone';
export type Room = 'hold' | 'cave' | 'shrine' | 'cabin' | 'den' | 'oldgrowth' | 'bowl';
export const STEP_KINDS: readonly StepKind[] = ['sand', 'wetSand', 'grass', 'rock', 'planks', 'stone', 'water'];
export const MATERIALS: readonly Material[] = ['flesh', 'shell', 'wood', 'stone'];
export const ROOMS: Record<Room, { rt60: number; pre: number; damp: number; early: number; spread: number; box?: [number, number] }> = {
  // a small planked hull: short, dark (wood eats the highs), boxy at ~240 Hz, dense early slap
  hold: { rt60: 0.6, pre: 0.004, damp: 0.45, early: 10, spread: 0.018, box: [240, 5] },
  // the sea cave: wet rock, mid-bright, a few strong discrete reflections off the walls
  cave: { rt60: 1.5, pre: 0.012, damp: 0.62, early: 7, spread: 0.045 },
  // the ring shrine's stone court under the jungle canopy: long, smooth, bright stone
  shrine: { rt60: 2.5, pre: 0.02, damp: 0.78, early: 12, spread: 0.07 },
  // Pine Hollow (PINE-HOLLOW-REMASTER PH-A5), the same generator — derived, 0 bytes:
  // a log cabin's room: short, woody (logs + chinking soak the highs), a low box mode ~180 Hz, a dense early slap
  cabin: { rt60: 0.5, pre: 0.003, damp: 0.5, early: 12, spread: 0.015, box: [180, 4] },
  // the bear den: a shallow granite cave, longer and darker than the sea cave, a few strong wall reflections
  den: { rt60: 1.8, pre: 0.015, damp: 0.55, early: 8, spread: 0.05 },
  // the old-growth: no walls, only giant trunks — many soft, late, diffuse reflections and a dark tail (needles eat the highs)
  oldgrowth: { rt60: 1.4, pre: 0.025, damp: 0.42, early: 16, spread: 0.12 },
  // the open bowl: sparse slaps off the valley sides a quarter-second out, a short dark tail
  bowl: { rt60: 0.9, pre: 0.06, damp: 0.5, early: 5, spread: 0.25 },
};

// ─────────────── layers (each adds into `out` at sample `at`) ───────────────
interface NoiseOpts { type: FilterType; f: number; f1?: number; q?: number; attack: number; decay: number; gain: number; pink?: boolean }
/** filtered noise with an attack / exponential-decay envelope, the filter optionally sweeping f → f1 over the sound */
function noise(out: Float32Array, at: number, sr: number, r: Rand, o: NoiseOpts): void {
  const n = Math.min(out.length - at, len(o.attack + o.decay * 5, sr));
  const f = new Biquad(o.type, o.f, o.q ?? 0.8, sr), pk = o.pink === true ? new Pink(r) : undefined;
  const span = o.attack + o.decay * 2;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (o.f1 !== undefined && (i & 15) === 0) f.set(o.type, o.f * (o.f1 / o.f) ** Math.min(1, t / span), o.q ?? 0.8);
    const x = pk ? pk.next() * 2.5 : r.bi();
    const j = at + i; if (j >= 0) out[j] = (out[j] ?? 0) + f.run(x) * ad(t, o.attack, o.decay) * o.gain;
  }
}
/** a low body thump: a sine gliding f0 → f1 with a fast attack and an exponential decay */
function thump(out: Float32Array, at: number, sr: number, f0: number, f1: number, decay: number, gain: number, attack = 0.003): void {
  const n = Math.min(out.length - at, len(attack + decay * 5, sr));
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, f = f1 + (f0 - f1) * Math.exp(-t / (decay * 0.6));
    ph += (2 * Math.PI * f) / sr;
    const j = at + i; if (j >= 0) out[j] = (out[j] ?? 0) + Math.sin(ph) * ad(t, attack, decay) * gain;
  }
}
/** a cloud of tiny noise clicks (sand grains, stems cracking, grit, crackle) through a band-pass; density in grains / s */
function grains(out: Float32Array, at: number, sr: number, r: Rand, o: { rate: number; dur: number; f: number; q: number; gain: number; grain?: number; shape?: number }): void {
  const n = Math.min(out.length - at, len(o.dur + 0.02, sr));
  const f = new Biquad('bandpass', o.f, o.q, sr), gd = (o.grain ?? 0.0015) * sr, p = o.rate / sr;
  let env = 0, amp = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (r.next() < p * (o.shape === undefined ? Math.exp(-t / (o.dur * 0.45)) * 1.6 : 1)) { env = 1; amp = 0.3 + r.next() * 0.7; }
    env *= Math.exp(-1 / gd);
    const j = at + i; if (j >= 0) out[j] = (out[j] ?? 0) + f.run(r.bi() * env * amp) * o.gain;
  }
}
/** a resonant strike: modal bank + a short noise excitation through it (wood, stone, shell) */
function strike(out: Float32Array, at: number, sr: number, r: Rand, modes: [number, number, number][], gain: number, jitter = 0.06, hard = true): void {
  const m = new Modes(sr, modes.map(([f, d, a]) => [f * (1 + r.bi() * jitter), d * (1 + r.bi() * 0.2), a] as const));
  m.strike(1, hard);
  const longest = Math.max(...modes.map((x) => x[1]));
  const n = Math.min(out.length - at, len(longest * 1.2 + 0.01, sr));
  const ex = len(0.002, sr);
  for (let i = 0; i < n; i++) {
    if (i < ex) m.strike(r.bi() * 0.25 * (1 - i / ex), true);
    const j = at + i; if (j >= 0) out[j] = (out[j] ?? 0) + m.run() * gain;
  }
}
/** a sharp broadband click (the contact transient) */
function click(out: Float32Array, at: number, sr: number, r: Rand, f: number, gain: number, dur = 0.002): void {
  noise(out, at, sr, r, { type: 'highpass', f, q: 0.7, attack: 0.0002, decay: dur, gain });
}
/** Minnaert bubbles: sines rising slightly in pitch, damped; `n` bubbles spread over `spread` s */
function bubbles(out: Float32Array, at: number, sr: number, r: Rand, n: number, spread: number, fLo: number, fHi: number, gain: number): void {
  for (let b = 0; b < n; b++) {
    const t0 = at + len(r.next() * spread, sr), f0 = fLo * (fHi / fLo) ** r.next(), tau = 0.004 + 3 / f0 * r.range(1, 3), g = gain * r.range(0.3, 1);
    const m = Math.min(out.length - t0, len(tau * 6, sr));
    let ph = 0;
    for (let i = 0; i < m; i++) {
      const t = i / sr; ph += (2 * Math.PI * f0 * (1 + t / tau * 0.12)) / sr;
      const j = t0 + i; if (j >= 0) out[j] = (out[j] ?? 0) + Math.sin(ph) * Math.exp(-t / tau) * Math.min(1, t * 4000) * g;
    }
  }
}
/** a formant voice: glottis (f0 / tenseness / breath contours) → parallel formants (vowel contour), enveloped */
function voice(out: Float32Array, at: number, sr: number, r: Rand, o: {
  dur: number; f0: (u: number) => number; tense: (u: number) => number; breath?: (u: number) => number;
  vowel: (u: number) => [number, number, number][]; env: (t: number) => number; gain: number; jitter?: number; shimmer?: number; rough?: number;
}): void {
  const n = Math.min(out.length - at, len(o.dur, sr));
  const g = new Glottis(sr, r, o.jitter ?? 0.02, o.shimmer ?? 0.08), fm = new Formants(sr, o.vowel(0));
  let sub = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / o.dur;
    if ((i & 31) === 0) fm.set(o.vowel(u));
    const f0 = o.f0(u);
    let x = g.run(f0, o.tense(u), o.breath?.(u) ?? 0.08);
    // roughness: amplitude modulation at f0/2 (the period-doubling of a strained / animal voice)
    if (o.rough !== undefined) { sub += (Math.PI * f0) / sr; x *= 1 - o.rough * (0.5 + 0.5 * Math.sin(sub)); }
    const j = at + i; if (j >= 0) out[j] = (out[j] ?? 0) + fm.run(x) * o.env(t) * o.gain * 4; // ×4: the narrow formant bands pass a fraction of the pulse's energy
  }
}
/** attack / hold / release envelope for voices */
const ahr = (a: number, h: number, rel: number) => (t: number): number => (t < a ? t / a : t < a + h ? 1 : Math.exp(-(t - a - h) / rel));
const lerp = (a: number, b: number, u: number): number => a + (b - a) * u;
const lerpV = (a: [number, number, number][], b: [number, number, number][], u: number): [number, number, number][] =>
  a.map(([f, q, g], i) => { const o = b[i] ?? [f, q, g]; return [lerp(f, o[0], u), lerp(q, o[1], u), lerp(g, o[2], u)]; });
const finish = (buf: Float32Array, sr: number, peak = 0.9, outS = 0.02): Float32Array => normalize(fade(buf, sr, 0.0005, outS), peak);


/** Render admitted offline layers with the bank's actual sample rate, variant seed and original DSP primitives. */
export function renderPcm(program:AudioPcmProgram,sr:number,seed:number):Float32Array {
  if(!Number.isFinite(sr)||sr<=0||sr>384000||!Number.isFinite(seed))throw new Error('Invalid PCM rate or seed');
  const r=new Rand(seed*program.seed[0]+program.seed[1]),values=new Map<string,number>([['seed',seed],['sr',sr]]),vowels=new Map<string,[number,number,number][]>();
  const read=(id:string):number=>{if(id==='random')return r.next();const value=values.get(id);if(value===undefined)throw new Error(`Missing PCM value: ${id}`);return value;};
  const value=(expr:AudioMixExpr):number=>audioMixValue(expr,read);
  for(const [id,expr] of program.values)values.set(id,value(expr));
  const duration=value(program.duration);if(!(duration>0&&duration<=60))throw new Error('PCM duration exceeds its bound');
  const out=new Float32Array(len(duration,sr));
  const modes=(rows:readonly (readonly [AudioMixExpr,AudioMixExpr,AudioMixExpr])[]):[number,number,number][]=>rows.map(row=>[value(row[0]),value(row[1]),value(row[2])]);
  type Step=Exclude<AudioPcmProgram['steps'][number],{kind:'repeat'}>;
  const run=(step:Step):void=>{
    switch(step.kind){
      case 'values':for(const [id,expr] of step.rows)values.set(id,value(expr));break;
      case 'formants':vowels.set(step.id,modes(step.rows));break;
      case 'noise':noise(out,value(step.at),sr,r,{type:step.type,f:value(step.f),attack:value(step.attack),decay:value(step.decay),gain:value(step.gain),
        ...(step.f1===undefined?{}:{f1:value(step.f1)}),...(step.q===undefined?{}:{q:value(step.q)}),...(step.pink===undefined?{}:{pink:step.pink})});break;
      case 'thump':thump(out,value(step.at),sr,value(step.args[0]),value(step.args[1]),value(step.args[2]),value(step.args[3]));break;
      case 'grains':grains(out,value(step.at),sr,r,{rate:value(step.rate),dur:value(step.dur),f:value(step.f),q:value(step.q),gain:value(step.gain),
        ...(step.grain===undefined?{}:{grain:value(step.grain)}),...(step.shape===undefined?{}:{shape:value(step.shape)})});break;
      case 'strike':strike(out,value(step.at),sr,r,modes(step.modes),value(step.gain),step.jitter===undefined?undefined:value(step.jitter));break;
      case 'click':click(out,value(step.at),sr,r,value(step.args[0]),value(step.args[1]),value(step.args[2]));break;
      case 'bubbles':bubbles(out,value(step.at),sr,r,value(step.args[0]),value(step.args[1]),value(step.args[2]),value(step.args[3]),value(step.args[4]));break;
      case 'voice':{
        const at=value(step.at),dur=value(step.dur),name=step.vowelIndex===undefined?step.vowel:`${step.vowel}.${value(step.vowelIndex)}`;
        const vowel=requireVowel(name),blend=step.blend,to=blend===undefined?undefined:requireVowel(blend.to);
        const curve=(expr:AudioMixExpr)=>(u:number):number=>{values.set('u',u);return value(expr);};
        voice(out,at,sr,r,{dur,f0:curve(step.f0),tense:curve(step.tense),breath:curve(step.breath),
          vowel:u=>{if(to===undefined||blend===undefined)return vowel;values.set('u',u);return lerpV(vowel,to,value(blend.amount));},
          env:ahr(value(step.env[0]),value(step.env[1]),value(step.env[2])),gain:value(step.gain),
          ...(step.rough===undefined?{}:{rough:value(step.rough)}),...(step.jitter===undefined?{}:{jitter:value(step.jitter)}),...(step.shimmer===undefined?{}:{shimmer:value(step.shimmer)})});break;
      }
      case 'saturate':saturate(out,value(step.drive));break;
      case 'filter':new Biquad(step.type,value(step.f),value(step.q),sr).apply(out);break;
      case 'flutter':{
        const filter=new Biquad('lowpass',value(step.f),value(step.q),sr),base=value(step.base),depth=value(step.depth),drive=value(step.drive);
        for(let i=0;i<out.length;i++)out[i]=(out[i]??0)*(base+depth*Math.tanh(filter.run(r.bi())*drive));break;
      }
      case 'sine':{
        const f=value(step.f),gain=value(step.gain);let ph=0;
        for(let i=0;i<out.length;i++){values.set('t',i/sr);ph+=(2*Math.PI*f)/sr;out[i]=(out[i]??0)+Math.sin(ph)*gain*value(step.envelope);}break;
      }
      default:throw new Error('Unsupported PCM instruction');
    }
  };
  function requireVowel(id:string):[number,number,number][]{const row=vowels.get(id);if(row===undefined)throw new Error(`Missing PCM formants: ${id}`);return row;}
  for(const step of program.steps){
    if(step.kind!=='repeat'){run(step);continue;}
    const count=value(step.count);if(!Number.isSafeInteger(count)||count<0||count>step.max)throw new Error('PCM repetition exceeds its bound');
    for(let i=0;i<count;i++){values.set(step.index,i);if(step.while!==undefined&&value(step.while)===0)break;for(const row of step.body)run(row);}
  }
  return finish(out,sr,program.finish[0],program.finish[1]);
}

// ─────────────── footsteps ───────────────
/** one step: heel strike, then the toe 45–75 ms later; each surface is its own recipe */
export function footstep(kind: StepKind, sr: number, seed: number): Float32Array {
  const r = new Rand(seed * 7919 + 17), out = new Float32Array(len(kind === 'planks' ? 0.42 : 0.34, sr));
  const toe = len(r.range(0.045, 0.075), sr), tg = r.range(0.45, 0.7);
  switch (kind) {
    case 'sand': // dry beach sand: a dull thud, a grainy crunch that swells and settles, the shuffle of displaced grains
      thump(out, 0, sr, r.range(75, 90), 45, 0.05, 0.22);
      noise(out, 0, sr, r, { type: 'lowpass', f: 380, q: 0.7, attack: 0.008, decay: 0.035, gain: 0.3 });
      grains(out, len(0.004, sr), sr, r, { rate: 1400, dur: 0.1, f: r.range(2000, 2800), q: 0.9, gain: 0.8 });
      noise(out, 0, sr, r, { type: 'bandpass', f: 1500, f1: 700, q: 0.7, attack: 0.02, decay: 0.05, gain: 0.3 });
      grains(out, toe, sr, r, { rate: 1000, dur: 0.07, f: r.range(2200, 3200), q: 0.9, gain: 0.4 * tg });
      noise(out, toe, sr, r, { type: 'bandpass', f: 1800, f1: 900, q: 0.7, attack: 0.012, decay: 0.035, gain: 0.2 * tg });
      break;
    case 'wetSand': // packed wet sand at the water line: heavier, darker, a small suck as the foot lifts, a bubble or two
      thump(out, 0, sr, r.range(70, 85), 42, 0.06, 0.35);
      noise(out, 0, sr, r, { type: 'lowpass', f: 300, q: 0.8, attack: 0.006, decay: 0.045, gain: 0.35 });
      grains(out, len(0.003, sr), sr, r, { rate: 500, dur: 0.06, f: 1600, q: 0.8, gain: 0.25 });
      noise(out, len(0.03, sr), sr, r, { type: 'bandpass', f: 750, f1: 380, q: 3.5, attack: 0.012, decay: 0.05, gain: 0.7 });
      bubbles(out, len(0.05, sr), sr, r, 2, 0.08, 900, 2200, 0.12);
      thump(out, toe, sr, 80, 50, 0.04, 0.3 * tg);
      noise(out, toe, sr, r, { type: 'lowpass', f: 400, attack: 0.005, decay: 0.03, gain: 0.3 * tg });
      break;
    case 'grass': // a foot pressing through grass: the blades' swish (no click), stems cracking, a soft earthy thud
      noise(out, 0, sr, r, { type: 'bandpass', f: r.range(3800, 5200), f1: 2600, q: 0.6, attack: 0.022, decay: 0.05, gain: 0.45 });
      noise(out, 0, sr, r, { type: 'lowpass', f: 260, q: 0.7, attack: 0.006, decay: 0.04, gain: 0.5 });
      thump(out, 0, sr, 85, 50, 0.04, 0.3);
      grains(out, len(0.006, sr), sr, r, { rate: 260, dur: 0.07, f: 3400, q: 1.4, gain: 0.35, grain: 0.0008 });
      noise(out, toe, sr, r, { type: 'bandpass', f: r.range(4200, 5600), f1: 3000, q: 0.6, attack: 0.018, decay: 0.04, gain: 0.3 * tg });
      break;
    case 'rock': // boot on bare rock: a hard tick, a short stony knock, grit scraping under the sole
      click(out, 0, sr, r, 2600, 0.6);
      strike(out, 0, sr, r, [[320, 0.035, 1], [780, 0.025, 0.6], [1450, 0.018, 0.4], [2300, 0.012, 0.3]], 0.35);
      thump(out, 0, sr, 110, 60, 0.035, 0.2);
      grains(out, len(0.008, sr), sr, r, { rate: 700, dur: 0.05, f: 3200, q: 1, gain: 0.55 });
      click(out, toe, sr, r, 3000, 0.25 * tg);
      grains(out, toe, sr, r, { rate: 900, dur: 0.06, f: 3600, q: 1, gain: 0.4 * tg });
      break;
    case 'planks': { // a boot on a pier / deck board: a hollow knock that rings down the planks, sometimes a creak
      const board: [number, number, number][] = [[r.range(105, 130), 0.2, 1], [r.range(230, 260), 0.14, 0.7], [r.range(390, 430), 0.1, 0.5], [r.range(660, 720), 0.07, 0.35], [r.range(1050, 1180), 0.045, 0.2]];
      click(out, 0, sr, r, 1800, 0.25);
      strike(out, 0, sr, r, board, 0.5);
      noise(out, 0, sr, r, { type: 'lowpass', f: 520, q: 0.8, attack: 0.004, decay: 0.03, gain: 0.35 });
      strike(out, toe, sr, r, board, 0.3 * tg);
      click(out, toe, sr, r, 2200, 0.15 * tg);
      if (r.next() < 0.3) { // the creak: a stick-slip friction tone, jittered, through the board's resonance
        const at = len(0.08, sr), n = len(0.18, sr), f = new Biquad('bandpass', r.range(700, 1100), 3, sr), f0 = r.range(160, 300);
        let ph = 0;
        for (let i = 0; i < n && at + i < out.length; i++) {
          const t = i / sr; ph += (f0 * (1 + 0.15 * Math.sin(t * 40) + r.bi() * 0.08)) / sr;
          const x = (ph % 1) < 0.2 ? 1 : -0.25;
          out[at + i] = (out[at + i] ?? 0) + f.run(x) * ad(t, 0.04, 0.06) * 0.08;
        }
      }
      break;
    }
    case 'stone': // the shrine's dressed stone: a clean hard tap with a bright stony ring, a dull thud under it
      click(out, 0, sr, r, 3200, 0.7, 0.003);
      strike(out, 0, sr, r, [[1150, 0.04, 1], [1900, 0.032, 0.8], [2800, 0.024, 0.6], [3900, 0.016, 0.4]], 0.4);
      thump(out, 0, sr, 95, 55, 0.045, 0.2);
      grains(out, len(0.006, sr), sr, r, { rate: 500, dur: 0.05, f: 4200, q: 1.2, gain: 0.35 });
      click(out, toe, sr, r, 3600, 0.3 * tg);
      strike(out, toe, sr, r, [[1200, 0.02, 1], [2000, 0.015, 0.7]], 0.08 * tg);
      break;
    case 'water': // ankle-deep: a slap, a slosh, bubbles and a little spray hiss
      noise(out, 0, sr, r, { type: 'bandpass', f: 1400, f1: 700, q: 0.8, attack: 0.004, decay: 0.05, gain: 0.55 });
      noise(out, 0, sr, r, { type: 'lowpass', f: 520, f1: 260, q: 0.8, attack: 0.01, decay: 0.07, gain: 0.45 });
      bubbles(out, len(0.01, sr), sr, r, 6, 0.14, 700, 2400, 0.14);
      noise(out, len(0.015, sr), sr, r, { type: 'bandpass', f: 3600, q: 0.7, attack: 0.02, decay: 0.07, gain: 0.14 });
      noise(out, toe, sr, r, { type: 'bandpass', f: 1100, f1: 600, q: 0.9, attack: 0.008, decay: 0.05, gain: 0.3 * tg });
      break;
    default: break; // every case is above
  }
  return finish(out, sr, 0.9, 0.03);
}

// ─────────────── combat ───────────────
/** a blade through the air: a band of noise whose centre and level follow the blade's bell-shaped velocity, an edge whistle at the peak, low air */
export function whoosh(sr: number, seed: number, heavy = false): Float32Array {
  const r = new Rand(seed * 104729 + 3), dur = heavy ? r.range(0.62, 0.72) : r.range(0.4, 0.48), out = new Float32Array(len(dur + 0.05, sr));
  const peak = r.range(0.4, 0.5), pk = new Pink(r);
  const body = new Biquad('bandpass', 300, 1.1, sr), edge = new Biquad('bandpass', 1500, 9, sr), air = new Biquad('lowpass', 180, 0.7, sr);
  const lo = heavy ? 180 : 260, span = heavy ? 1200 : 1800, ef = r.range(1.6, 2.1);
  for (let i = 0; i < out.length; i++) {
    const u = i / sr / dur;
    const v = u <= 0 || u >= 1 ? 0 : u < peak ? Math.sin((u / peak) * Math.PI * 0.5) ** 2 : Math.cos(((u - peak) / (1 - peak)) * Math.PI * 0.5) ** 2;
    if ((i & 15) === 0) { const fc = lo + span * v; body.set('bandpass', fc, 1.1); edge.set('bandpass', fc * ef, 9); }
    const w = r.bi(), p = pk.next() * 2.5;
    out[i] = body.run(p * 0.6 + w * 0.4) * v ** 1.6 + edge.run(w) * v ** 3 * (heavy ? 0.25 : 0.4) + air.run(p) * v * v * (heavy ? 0.9 : 0.5);
  }
  return finish(out, sr, 0.9, 0.04);
}

/** a hit: the contact transient + the material's body */
export function impact(m: Material, sr: number, seed: number): Float32Array {
  const r = new Rand(seed * 15485863 + 11), out = new Float32Array(len(m === 'wood' ? 0.45 : 0.4, sr));
  switch (m) {
    case 'flesh': // a meaty slap: bright contact, a wet mid squelch, a heavy low thump
      click(out, 0, sr, r, 2800, 0.35, 0.0015);
      noise(out, 0, sr, r, { type: 'lowpass', f: 2000, q: 0.7, attack: 0.001, decay: 0.018, gain: 1.0 });
      thump(out, 0, sr, r.range(110, 135), 52, 0.09, 0.7);
      noise(out, len(0.006, sr), sr, r, { type: 'bandpass', f: r.range(550, 700), f1: 300, q: 3, attack: 0.004, decay: 0.06, gain: 0.75 });
      noise(out, len(0.004, sr), sr, r, { type: 'lowpass', f: 500, q: 0.7, attack: 0.004, decay: 0.05, gain: 0.5, pink: true });
      saturate(out, 1.8);
      break;
    case 'shell': // the crab's carapace: a hard crack, a hollow chitin ring, shards skittering
      click(out, 0, sr, r, 4000, 0.7, 0.0015);
      strike(out, 0, sr, r, [[r.range(1650, 1850), 0.05, 1], [2650, 0.04, 0.7], [3900, 0.03, 0.5], [5200, 0.02, 0.35], [620, 0.07, 0.45]], 0.5, 0.08);
      thump(out, 0, sr, 150, 80, 0.05, 0.22);
      grains(out, len(0.02, sr), sr, r, { rate: 180, dur: 0.12, f: 4500, q: 2, gain: 0.25, grain: 0.0008 });
      break;
    case 'wood': // a knock on wood: resonant plank modes, splinter crackle
      click(out, 0, sr, r, 2200, 0.35, 0.002);
      strike(out, 0, sr, r, [[r.range(175, 205), 0.13, 1], [430, 0.09, 0.8], [760, 0.065, 0.55], [1320, 0.04, 0.35], [2100, 0.025, 0.2]], 0.6);
      thump(out, 0, sr, 100, 60, 0.06, 0.45);
      grains(out, len(0.004, sr), sr, r, { rate: 500, dur: 0.08, f: 2600, q: 1.2, gain: 0.25, grain: 0.001 });
      break;
    case 'stone': // the blade on rock: a sharp crack, a dense short stone ring, grit
      click(out, 0, sr, r, 3500, 0.8, 0.0018);
      strike(out, 0, sr, r, [[r.range(880, 960), 0.07, 1], [1430, 0.06, 0.8], [2170, 0.045, 0.7], [2960, 0.035, 0.55], [3810, 0.03, 0.45], [4700, 0.025, 0.35], [5900, 0.02, 0.25]], 0.4, 0.05);
      thump(out, 0, sr, 90, 50, 0.05, 0.25);
      grains(out, len(0.003, sr), sr, r, { rate: 900, dur: 0.06, f: 4200, q: 1, gain: 0.25 });
      break;
    default: break; // every case is above
  }
  return finish(out, sr, 0.92, 0.04);
}


/** the player takes a hit: a short grunt ("uh" / "ah" / "oof" by variant) over a body impact, an exhale tail */
export function hurt(sr: number, seed: number): Float32Array {
  return renderPcm({seed:[69069,1],values:[['f0a',['+',135,['*','random',['-',165,135]]]],['d',['+',0.16,['*','random',['-',0.22,0.16]]]]],duration:0.5,steps:[
    {kind:'formants',id:'vowels.0',rows:[[640,5,1],[1180,6,0.55],[2600,8,0.2]]},
    {kind:'formants',id:'vowels.1',rows:[[760,5,1],[1260,6,0.5],[2700,8,0.2]]},
    {kind:'formants',id:'vowels.2',rows:[[460,5,1],[880,6,0.5],[2500,8,0.15]]},
    {kind:'thump',at:0,args:[95,48,0.07,0.4]},
    {kind:'noise',at:0,type:'lowpass',f:900,attack:0.001,decay:0.02,gain:0.5},
    {kind:'voice',at:['max',1,['round',['*',0.012,'sr']]],dur:['+','d',0.12],f0:['*','f0a',['lerp',1.08,0.78,'u']],tense:['lerp',0.9,0.6,'u'],breath:['lerp',0.12,0.3,'u'],rough:0.15,vowel:'vowels',vowelIndex:['%','seed',3],env:[0.012,['*','d',0.45],0.06],gain:1.4,jitter:0.025,shimmer:0.1},
    {kind:'noise',at:['max',1,['round',['*','d','sr']]],type:'bandpass',f:1300,f1:800,q:1.2,attack:0.02,decay:0.07,gain:0.1},
    {kind:'saturate',drive:1.3}],finish:[0.9,0.05]},sr,seed);
}

/** the player dies: the hit, a falling groan that runs out of breath, the body hitting the ground */
export function death(sr: number, seed: number): Float32Array {
  const r = new Rand(seed * 40503 + 9), dur = r.range(0.85, 1.0), out = new Float32Array(len(1.7, sr));
  thump(out, 0, sr, 100, 45, 0.1, 0.5);
  noise(out, 0, sr, r, { type: 'lowpass', f: 1200, attack: 0.001, decay: 0.03, gain: 0.5 });
  const ah: [number, number, number][] = [[740, 5, 1], [1220, 6, 0.55], [2650, 8, 0.2]], uh: [number, number, number][] = [[520, 5, 1], [980, 6, 0.45], [2450, 8, 0.12]];
  voice(out, len(0.02, sr), sr, r, {
    dur, f0: (u) => lerp(150, 78, u ** 0.8), tense: (u) => lerp(0.8, 0.15, u), breath: (u) => lerp(0.12, 0.45, u), rough: 0.25,
    vowel: (u) => lerpV(ah, uh, u), env: ahr(0.02, dur * 0.45, dur * 0.22), gain: 1.3, jitter: 0.035, shimmer: 0.14,
  });
  const fall = len(dur + 0.08, sr);
  thump(out, fall, sr, 75, 38, 0.12, 0.6);
  noise(out, fall, sr, r, { type: 'lowpass', f: 420, attack: 0.004, decay: 0.07, gain: 0.6 });
  grains(out, fall, sr, r, { rate: 700, dur: 0.18, f: 2400, q: 0.8, gain: 0.25 });
  return finish(saturate(out, 1.2), sr, 0.9, 0.1);
}

// ─────────────── water ───────────────
/** crossing the surface: down = a plunge (a low gloop, the water closing, a bubble cloud); up = water sheeting off, drips */
export function plunge(sr: number, seed: number, up: boolean): Float32Array {
  const r = new Rand(seed * 7 + (up ? 101 : 3)), out = new Float32Array(len(0.9, sr));
  if (!up) {
    thump(out, 0, sr, 150, 38, 0.14, 0.7, 0.01);
    noise(out, 0, sr, r, { type: 'lowpass', f: 1400, f1: 180, q: 0.8, attack: 0.008, decay: 0.12, gain: 0.8 });
    bubbles(out, len(0.04, sr), sr, r, 26, 0.6, 350, 1800, 0.12);
  } else {
    noise(out, 0, sr, r, { type: 'bandpass', f: 1500, f1: 600, q: 0.6, attack: 0.01, decay: 0.12, gain: 0.6 });
    noise(out, len(0.02, sr), sr, r, { type: 'highpass', f: 3000, attack: 0.02, decay: 0.1, gain: 0.25 });
    bubbles(out, len(0.18, sr), sr, r, 7, 0.55, 1800, 4200, 0.07);
  }
  return finish(out, sr, 0.9, 0.08);
}

/** a seamless underwater loop: sparse bubbles near and far over a slow pressure rumble (the end crossfaded into the start) */
export function bubbleBed(sr: number, seed: number, sec = 6): Float32Array {
  const r = new Rand(seed * 1013 + 77), n = len(sec, sr), x = len(0.5, sr), out = new Float32Array(n + x);
  const pk = new Pink(r), lp = new Biquad('lowpass', 110, 0.8, sr), lp2 = new Biquad('lowpass', 240, 0.6, sr);
  for (let i = 0; i < out.length; i++) out[i] = lp2.run(lp.run(pk.next() * 3)) * (0.8 + 0.2 * Math.sin((2 * Math.PI * i) / n * 2));
  for (let k = 0; k < Math.round(sec * 3); k++) bubbles(out, len(r.next() * sec, sr), sr, r, 1 + Math.floor(r.next() * 4), 0.25, 300, 1500, r.range(0.04, 0.12));
  // crossfade the overhang into the head, so the loop point is silent
  for (let i = 0; i < x; i++) { const u = i / x; out[i] = (out[i] ?? 0) * u + (out[n + i] ?? 0) * (1 - u); }
  return normalize(out.subarray(0, n).slice(), 0.6);
}

// ─────────────── rooms ───────────────
/** one channel of a stereo impulse response (ch 0 = L, 1 = R: decorrelated noise): pre-delay, sparse early reflections, then a
 *  two-band exponential tail (the highs quieter and dying sooner by `damp`); unit energy, so white noise in → the same level out */
export function impulseChannel(room: Room, sr: number, seed: number, ch: number): Float32Array {
  const R = ROOMS[room], n = len(R.rt60 * 1.25 + R.pre, sr);
  const r = new Rand(seed * 977 + ch * 131 + room.length), out = new Float32Array(n), pre = len(R.pre, sr);
  const lo = new Biquad('lowpass', 1500, 0.7, sr), hi = new Biquad('highpass', 1500, 0.7, sr);
  const kLo = 6.9 / R.rt60, kHi = 6.9 / (R.rt60 * R.damp);
  for (let i = pre; i < n; i++) {
    const t = (i - pre) / sr, w = r.gauss();
    out[i] = lo.run(w) * Math.exp(-kLo * t) + hi.run(w) * Math.exp(-kHi * t) * 0.3; // highs quieter as well as shorter (a natural tilt)
  }
  // the tail swells in over `spread` s; the early reflections sit on top of it
  const sw = len(R.spread, sr);
  for (let i = 0; i < sw && pre + i < n; i++) out[pre + i] = (out[pre + i] ?? 0) * (i / sw) ** 1.5;
  for (let k = 0; k < R.early; k++) {
    const t = R.pre + r.range(0.003, R.spread * 1.3), j = len(t, sr);
    if (j < n) out[j] = (out[j] ?? 0) + (r.next() < 0.5 ? -1 : 1) * r.range(1.2, 3) / (1 + t * 30);
  }
  if (R.box) new Biquad('peaking', R.box[0], 1.2, sr, R.box[1]).apply(out);
  new Biquad('highpass', 90, 0.7, sr).apply(out); // no low-end mud in the send
  new Biquad('lowpass', 9000, 0.7, sr).apply(out);
  let e = 0; for (let i = 0; i < n; i++) e += (out[i] ?? 0) ** 2;
  const k = 1 / Math.sqrt(Math.max(1e-12, e));
  for (let i = 0; i < n; i++) out[i] = (out[i] ?? 0) * k;
  return out;
}

// ─────────────── interactables (the adventure kit, src/world/interact/*) ───────────────
/** a stick-slip creak: a friction pulse train whose pitch wanders f0a → f0b with jumps, through wooden (or iron) body resonances */
function creak(out: Float32Array, at: number, sr: number, r: Rand, o: { dur: number; f0a: number; f0b: number; gain: number; body: [number, number][]; attack?: number }): void {
  const n = Math.min(out.length - at, len(o.dur, sr));
  const fs = o.body.map(([f, q]) => new Biquad('bandpass', f, q, sr));
  let ph = 0, jump = 1, slip = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr, u = t / o.dur;
    if (r.next() < 18 / sr) jump = 1 + r.bi() * 0.18;                         // the grain catches: the pitch jumps
    const f0 = (o.f0a + (o.f0b - o.f0a) * u) * jump * (1 + 0.04 * Math.sin(t * 2 * Math.PI * 7));
    ph += f0 / sr;
    if (ph >= 1) { ph -= 1; slip = 1 + r.bi() * 0.3; }                        // each slip: a sharp release, amplitude jittered
    slip *= 0.9;
    let y = 0; for (const f of fs) y += f.run(slip + r.bi() * 0.04);
    const env = Math.min(1, t / (o.attack ?? 0.05)) * Math.min(1, (o.dur - t) / 0.08) * (0.7 + 0.3 * Math.sin(u * Math.PI));
    const j = at + i; if (j >= 0) out[j] = (out[j] ?? 0) + y * env * o.gain;
  }
}
/** a struck bell / glass partial set (inharmonic: 1, 2.76, 5.40, 8.93) */
function chimeNote(out: Float32Array, at: number, sr: number, r: Rand, f: number, decay: number, gain: number): void {
  strike(out, at, sr, r, [[f, decay, 1], [f * 2.76, decay * 0.6, 0.45], [f * 5.4, decay * 0.35, 0.22], [f * 8.93, decay * 0.2, 0.1]], gain, 0.004, false);
  click(out, at, sr, r, 6000, gain * 0.08, 0.001);
}

export type InteractSound = 'chest' | 'locked' | 'lever' | 'plate' | 'door' | 'grate' | 'chime' | 'glyph' | 'ignite';
export const INTERACT_SOUNDS: readonly InteractSound[] = ['chest', 'locked', 'lever', 'plate', 'door', 'grate', 'chime', 'glyph', 'ignite'];
const WOOD_BODY: [number, number][] = [[420, 6], [880, 7], [1650, 8]];
const IRON_BODY: [number, number][] = [[1250, 14], [2380, 16], [3900, 18]];
const LID: [number, number, number][] = [[150, 0.14, 1], [340, 0.1, 0.7], [610, 0.07, 0.5], [1050, 0.045, 0.3]];

/** the adventure kit's sounds: a chest opening (hinge creak, then the lid thudding back), a locked rattle, a lever clunk, a
 *  stone pressure plate grinding down, a plank door creak, an iron grate grinding, a pickup chime (sea glass, keys), a
 *  glyph shard's brighter shimmer, the beacon catching */
export function interact(k: InteractSound, sr: number, seed: number): Float32Array {
  const r = new Rand(seed * 92821 + k.length * 7);
  switch (k) {
    case 'chest': { // the hinges creak up, the lid swings over and thuds against its stays
      const out = new Float32Array(len(1.05, sr)), up = r.range(0.42, 0.55);
      click(out, 0, sr, r, 2500, 0.3, 0.002);                                  // the hasp lifting
      strike(out, 0, sr, r, [[2300, 0.03, 1], [3500, 0.02, 0.6]], 0.12);
      creak(out, len(0.04, sr), sr, r, { dur: up, f0a: r.range(70, 90), f0b: r.range(120, 150), gain: 0.6, body: WOOD_BODY });
      const th = len(0.04 + up + 0.02, sr);
      strike(out, th, sr, r, LID, 0.55);
      thump(out, th, sr, 110, 55, 0.07, 0.5);
      noise(out, th, sr, r, { type: 'lowpass', f: 900, attack: 0.002, decay: 0.03, gain: 0.35 });
      return finish(out, sr, 0.9, 0.08);
    }
    case 'locked': { // the lid tugged against its hasp: three or four rattling knocks and the iron clinking
      const out = new Float32Array(len(0.55, sr)), n = 3 + Math.floor(r.next() * 2);
      let t = 0;
      for (let q = 0; q < n; q++) {
        const at = len(t, sr), g = 1 - q * 0.18;
        strike(out, at, sr, r, LID.map(([f, d, a]) => [f * 1.25, d * 0.5, a] as [number, number, number]), 0.35 * g);
        strike(out, at + len(0.006, sr), sr, r, [[r.range(2600, 3000), 0.05, 1], [4100, 0.035, 0.6], [5900, 0.02, 0.4]], 0.18 * g, 0.03);
        t += r.range(0.075, 0.11);
      }
      return finish(out, sr, 0.9, 0.05);
    }
    case 'lever': { // a ratchet, then the heavy clunk of the mechanism engaging, a chain rattle under it
      const out = new Float32Array(len(0.75, sr));
      for (let q = 0; q < 3; q++) strike(out, len(q * 0.07, sr), sr, r, [[r.range(1800, 2200), 0.02, 1], [3100, 0.015, 0.5]], 0.18 + q * 0.04);
      creak(out, 0, sr, r, { dur: 0.22, f0a: 140, f0b: 190, gain: 0.18, body: WOOD_BODY, attack: 0.02 });
      const cl = len(0.24, sr);
      strike(out, cl, sr, r, [[r.range(85, 100), 0.18, 1], [230, 0.12, 0.7], [410, 0.08, 0.5], [760, 0.05, 0.3]], 0.7);
      click(out, cl, sr, r, 1800, 0.35, 0.003);
      thump(out, cl, sr, 90, 45, 0.1, 0.5);
      grains(out, cl + len(0.02, sr), sr, r, { rate: 220, dur: 0.3, f: 3400, q: 3, gain: 0.25, grain: 0.004 });
      return finish(out, sr, 0.9, 0.08);
    }
    case 'plate': { // a stone slab grinding down into its socket, grit spilling, the thunk at the bottom
      const out = new Float32Array(len(0.8, sr)), d = r.range(0.42, 0.52);
      noise(out, 0, sr, r, { type: 'bandpass', f: 380, f1: 240, q: 1.2, attack: 0.06, decay: d * 0.45, gain: 0.8, pink: true });
      grains(out, 0, sr, r, { rate: 900, dur: d, f: 1400, q: 1.1, gain: 0.45, grain: 0.0025, shape: 1 });
      grains(out, len(0.05, sr), sr, r, { rate: 400, dur: d, f: 3800, q: 1.4, gain: 0.2 });
      const b = len(d, sr);
      thump(out, b, sr, 80, 42, 0.12, 0.75);
      strike(out, b, sr, r, [[r.range(300, 340), 0.05, 1], [720, 0.035, 0.6], [1350, 0.025, 0.4]], 0.3);
      return finish(out, sr, 0.9, 0.08);
    }
    case 'door': { // a plank door on dry hinges: a long wandering creak and the door bumping to a stop
      const out = new Float32Array(len(1.25, sr)), d = r.range(0.8, 0.95);
      creak(out, 0, sr, r, { dur: d, f0a: r.range(55, 70), f0b: r.range(95, 130), gain: 0.7, body: [[380, 6], [760, 7], [1420, 8], [2300, 9]], attack: 0.1 });
      const st = len(d + 0.02, sr);
      strike(out, st, sr, r, LID.map(([f, dd, a]) => [f * 0.8, dd * 1.2, a] as [number, number, number]), 0.45);
      thump(out, st, sr, 95, 50, 0.08, 0.4);
      return finish(out, sr, 0.9, 0.1);
    }
    case 'grate': { // an iron grate / sluice: a rusty screech grinding along, the latch clanking free, a ringing clank at the end
      const out = new Float32Array(len(1.2, sr)), d = r.range(0.7, 0.85);
      strike(out, 0, sr, r, [[r.range(1400, 1600), 0.12, 1], [2650, 0.09, 0.7], [4100, 0.06, 0.5], [620, 0.15, 0.5]], 0.35, 0.02);
      creak(out, len(0.06, sr), sr, r, { dur: d, f0a: r.range(160, 200), f0b: r.range(230, 280), gain: 0.4, body: IRON_BODY, attack: 0.08 });
      noise(out, len(0.06, sr), sr, r, { type: 'bandpass', f: 700, q: 1, attack: 0.1, decay: d * 0.4, gain: 0.25, pink: true });
      const st = len(0.06 + d, sr);
      strike(out, st, sr, r, [[r.range(480, 540), 0.35, 1], [1290, 0.25, 0.7], [2210, 0.18, 0.55], [3470, 0.12, 0.4]], 0.45, 0.02);
      thump(out, st, sr, 100, 50, 0.07, 0.45);
      return finish(out, sr, 0.9, 0.1);
    }
    case 'chime': { // a sea-glass / key pickup: two glassy notes a fifth apart
      const out = new Float32Array(len(1.0, sr)), f = r.range(1250, 1400);
      chimeNote(out, 0, sr, r, f, 0.55, 0.6);
      chimeNote(out, len(0.085, sr), sr, r, f * 1.5, 0.7, 0.55);
      return finish(out, sr, 0.85, 0.2);
    }
    case 'glyph': { // a glyph shard: a bright rising arpeggio over a low swell, with a shimmer of high partials
      const out = new Float32Array(len(1.7, sr)), f = r.range(880, 940);
      for (const [q, m] of [[0, 1], [1, 1.25], [2, 1.5], [3, 2]] as const) chimeNote(out, len(q * 0.075, sr), sr, r, f * m, 1.1, 0.5);
      for (let q = 0; q < 10; q++) chimeNote(out, len(0.3 + r.next() * 0.8, sr), sr, r, f * 4 * (1 + r.next()), 0.25, 0.08);
      let ph = 0;
      for (let i = 0; i < out.length; i++) { const t = i / sr; ph += (2 * Math.PI * f / 4) / sr; out[i] = (out[i] ?? 0) + Math.sin(ph) * 0.18 * Math.min(1, t / 0.25) * Math.exp(-Math.max(0, t - 0.3) / 0.45); }
      return finish(out, sr, 0.85, 0.3);
    }
    case 'ignite': { // the beacon catching: a whoomph of flame climbing, then a roar settling into crackle
      const out = new Float32Array(len(1.8, sr));
      click(out, 0, sr, r, 3000, 0.25, 0.003);                                 // the strike of flint on steel
      grains(out, 0, sr, r, { rate: 900, dur: 0.06, f: 5200, q: 2, gain: 0.3, grain: 0.0008 });
      noise(out, len(0.08, sr), sr, r, { type: 'lowpass', f: 180, f1: 2200, q: 1, attack: 0.25, decay: 0.35, gain: 1.0, pink: true });
      noise(out, len(0.2, sr), sr, r, { type: 'bandpass', f: 500, q: 0.6, attack: 0.2, decay: 0.6, gain: 0.45, pink: true });
      grains(out, len(0.15, sr), sr, r, { rate: 60, dur: 1.5, f: 2800, q: 0.8, gain: 0.45, grain: 0.0015, shape: 1 });
      thump(out, len(0.1, sr), sr, 70, 40, 0.35, 0.35, 0.15);
      return finish(saturate(out, 1.2), sr, 0.9, 0.2);
    }
    default: break; // every InteractSound has a case above
  }
  throw new Error(`interact: ${String(k)}`);
}

/** a seamless noise loop for the ambience beds (white, or pink with its 1/f tilt), the end crossfaded into the start */
export function noiseLoop(sr: number, seed: number, pink: boolean, sec = 4): Float32Array {
  const r = new Rand(seed * 4099 + (pink ? 7 : 3)), pk = new Pink(r), n = len(sec, sr), x = len(0.25, sr), out = new Float32Array(n + x);
  for (let i = 0; i < out.length; i++) out[i] = pink ? pk.next() * 2.5 : r.bi() * 0.6;
  for (let i = 0; i < x; i++) { const u = i / x; out[i] = (out[i] ?? 0) * Math.sqrt(u) + (out[n + i] ?? 0) * Math.sqrt(1 - u); }
  return out.subarray(0, n).slice();
}
