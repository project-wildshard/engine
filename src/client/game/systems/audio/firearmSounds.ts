import { audioRandom } from '@wildshard/engine/audio/util';
import { tap } from '@wildshard/engine/core/harnessTap';
import type { WeaponSynth } from "../../plugin/audio";

const rnd = (a: number, b: number): number => a + audioRandom() * (b - a);

export function rifleFire(audio: WeaponSynth): void {
  tap.sound?.('rifleFire');
  if (!audio.ready || audio.shot('rifleFire')) return;
  const t = audio.ctx.currentTime;
  // the crack: a ~5 ms highpass transient at full tilt
  audio.burst({ t, type: 'highpass', freq: 3800, gain: 0.9, decay: 0.018 });
  // muzzle bark: bandpass noise sweeping down, the "bang" body
  audio.burst({ t: t + 0.002, type: 'bandpass', freq: 1500, freqEnd: 320, q: 0.7, gain: 1.0, decay: 0.09 });
  // chest thump
  audio.tone({ t: t + 0.001, type: 'sine', f0: 150, f1: 45, glide: 0.09, gain: 0.9, decay: 0.2 });
  // action cycling: bolt carrier slam + a tiny brass tink
  audio.burst({ t: t + 0.055, type: 'bandpass', freq: 2200, q: 2.5, gain: 0.22, decay: 0.03 });
  audio.tone({ t: t + 0.11 + rnd(0, 0.03), type: 'sine', f0: rnd(5200, 6400), gain: 0.05, decay: 0.05 });
  // forest echo tail: low-passed noise dying over ~0.35 s, a little off to one side each shot
  audio.burst({ t: t + 0.04, type: 'lowpass', freq: 900, freqEnd: 250, gain: 0.35, attack: 0.01, decay: 0.34, pan: rnd(-0.25, 0.25) });
}

export function rifleReload(audio: WeaponSynth): void {
  tap.sound?.('rifleReload');
  if (!audio.ready || audio.shot('rifleReload')) return;
  const t0 = audio.ctx.currentTime + 0.05;
  // mag release button
  audio.burst({ t: t0, type: 'bandpass', freq: 2600, q: 3, gain: 0.25, decay: 0.015 });
  // mag sliding out + hitting the dirt
  audio.burst({ t: t0 + 0.08, type: 'bandpass', freq: 1400, freqEnd: 700, q: 1, gain: 0.18, decay: 0.09 });
  audio.burst({ t: t0 + 0.42, type: 'lowpass', freq: 420, gain: 0.3, decay: 0.08 });
  // fresh mag seated with a slap, then the tug check
  const ts = t0 + 1.0;
  audio.burst({ t: ts, type: 'bandpass', freq: 1100, q: 1.2, gain: 0.5, decay: 0.05 });
  audio.tone({ t: ts, type: 'sine', f0: 260, f1: 140, glide: 0.04, gain: 0.3, decay: 0.07 });
  audio.burst({ t: ts + 0.12, type: 'bandpass', freq: 1800, q: 2, gain: 0.15, decay: 0.03 });
  // bolt release: heavy steel clack + receiver ring
  const tb = t0 + 1.4;
  audio.burst({ t: tb, type: 'bandpass', freq: 1900, q: 1.5, gain: 0.55, decay: 0.04 });
  audio.tone({ t: tb, type: 'triangle', f0: 720, f1: 480, glide: 0.05, gain: 0.2, decay: 0.09 });
  audio.tone({ t: tb, type: 'sine', f0: 200, f1: 110, glide: 0.05, gain: 0.35, decay: 0.09 });
}
