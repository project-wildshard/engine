// The procedural voice families and what renders one variant channel, apart from the pool (Voices.ts) so the render
// worker (voiceRender.worker.ts) can import them with no DOM: meta IPHONE13-DRIFTWOOD DW3 (mini-driftwood13d).
import type { AudioPcmProgram } from '@wildshard/format/audioProfiles';
import { footstep, whoosh, impact, hurt, death, plunge, bubbleBed, noiseLoop, impulseChannel, interact, renderPcm, STEP_KINDS, MATERIALS, INTERACT_SOUNDS, type Material, type Room } from './gen';

/** What renders a family off the main thread: plain data a worker can take (a built-in family by name, a declared impact
 *  material or PCM program). A family without one renders on the main thread only. */
export type VoiceWork = { readonly kind: 'family'; readonly name: string } | { readonly kind: 'impact'; readonly material: Material }
  | { readonly kind: 'pcm'; readonly program: AudioPcmProgram };

type Gen = (sr: number, seed: number) => Float32Array;
/** `half`: rendered at half the context rate (sounds with nothing above ~6 kHz — the long vocals, the bubble bed): half the
 *  render time and memory, and the source resamples on play (IRs must stay at the context rate: ConvolverNode requires it) */
export interface Family { n: number; ch: 1 | 2; half?: boolean; gen: Gen | ((sr: number, seed: number, ch: number) => Float32Array); work?: VoiceWork }

const fam = (n: number, gen: Gen, half = false): Family => ({ n, ch: 1, half, gen });
const room = (r: Room): Family => ({ n: 1, ch: 2, gen: (sr: number, seed: number, ch: number) => impulseChannel(r, sr, seed, ch) });

/** every family: the name the callers use → variant count + generator */
export const FAMILIES: Record<string, Family> = {
  ...Object.fromEntries(STEP_KINDS.map((k) => [`step-${k}`, fam(5, (sr, s) => footstep(k, sr, s))])),
  whoosh: fam(4, (sr, s) => whoosh(sr, s)),
  'whoosh-heavy': fam(3, (sr, s) => whoosh(sr, s, true)),
  // a level's own families (creature vocals, wind-ups, its own impact materials) are its voice table (`voices.register`)
  ...Object.fromEntries(MATERIALS.filter((m) => m !== 'shell').map((m) => [`impact-${m}`, fam(4, (sr, s) => impact(m, sr, s))])),
  hurt: fam(3, (sr, s) => hurt(sr, s), true),
  death: fam(2, (sr, s) => death(sr, s), true),
  'plunge-down': fam(2, (sr, s) => plunge(sr, s, false)),
  'plunge-up': fam(2, (sr, s) => plunge(sr, s, true)),
  'bubble-bed': fam(1, (sr, s) => bubbleBed(sr, s), true),
  'noise-white': fam(1, (sr, s) => noiseLoop(sr, s, false)),
  'noise-pink': fam(1, (sr, s) => noiseLoop(sr, s, true)),
  ...Object.fromEntries(INTERACT_SOUNDS.map((k) => [`ui-${k}`, fam(k === 'glyph' ? 1 : 2, (sr, s) => interact(k, sr, s))])),
  'ir-hold': room('hold'), 'ir-cave': room('cave'), 'ir-shrine': room('shrine'),
  'ir-cabin': room('cabin'), 'ir-den': room('den'), 'ir-oldgrowth': room('oldgrowth'), 'ir-bowl': room('bowl'), // Pine Hollow (PH-A5)
};
export type FamilyName = keyof typeof FAMILIES;

/** One channel of one variant (`seed` is the variant + 1), as the pool's main-thread render makes it. */
export function renderVoiceWork(work: VoiceWork, sr: number, seed: number, ch: number): Float32Array {
  if (work.kind === 'impact') return impact(work.material, sr, seed);
  if (work.kind === 'pcm') return renderPcm(work.program, sr, seed);
  const family = FAMILIES[work.name];
  if (family === undefined) throw new Error(`No voice family ${work.name}`);
  return family.gen(sr, seed, ch);
}
