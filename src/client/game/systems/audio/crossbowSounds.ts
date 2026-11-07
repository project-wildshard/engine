import type { ImpactKind } from '@wildshard/engine/audio/Audio';
import { audioRandom } from '@wildshard/engine/audio/util';
import { tap } from '@wildshard/engine/core/harnessTap';
import type { WeaponSynth } from "../../plugin/audio";

const rnd = (a: number, b: number): number => a + audioRandom() * (b - a);

export function crossbowFire(audio: WeaponSynth): void {
  tap.sound?.('crossbowFire');
  if (!audio.ready || audio.shot('crossbowFire')) return;
  const t = audio.ctx.currentTime;
  // latch release click
  audio.burst({ t, type: 'highpass', freq: 2500, gain: 0.35, decay: 0.012 });
  // string twang: bright noise + a plucked triangle that drops fast
  audio.burst({ t: t + 0.004, type: 'bandpass', freq: 2600, freqEnd: 900, q: 0.8, gain: 0.7, decay: 0.07 });
  audio.tone({ t: t + 0.004, type: 'triangle', f0: 210, f1: 95, glide: 0.08, gain: 0.35, decay: 0.16 });
  // body thump 120 → 60 Hz
  audio.tone({ t: t + 0.002, type: 'sine', f0: 120, f1: 60, glide: 0.1, gain: 0.8, decay: 0.24 });
  // stock resonance / limb rattle
  audio.burst({ t: t + 0.02, type: 'lowpass', freq: 500, gain: 0.3, decay: 0.12 });
}

export function dryFire(audio: WeaponSynth): void {
  tap.sound?.('dryFire');
  if (!audio.ready || audio.shot('dryFire')) return;
  const t = audio.ctx.currentTime;
  audio.burst({ t, type: 'highpass', freq: 3000, gain: 0.25, decay: 0.01 });
  audio.tone({ t, type: 'square', f0: 700, gain: 0.05, decay: 0.03, lowpass: 2000 });
}

export function boltImpact(audio: WeaponSynth, kind: ImpactKind, pan = 0, gain = 1): void {
  tap.sound?.(`boltImpact:${kind}`);
  if (!audio.ready || audio.shot(`boltImpact-${kind}`, { pan, gain })) return;
  const t = audio.ctx.currentTime;
  if (kind === 'wood') {
    audio.burst({ t, type: 'bandpass', freq: 1900, q: 2.5, gain: 0.55 * gain, decay: 0.05, pan });
    audio.tone({ t, type: 'triangle', f0: 620, f1: 380, glide: 0.05, gain: 0.25 * gain, decay: 0.09, pan });
    audio.tone({ t, type: 'sine', f0: 240, f1: 120, glide: 0.04, gain: 0.35 * gain, decay: 0.08, pan });
    // shaft vibration hum
    audio.tone({ t: t + 0.01, type: 'sine', f0: 95, gain: 0.12 * gain, decay: 0.35, vibrato: { rate: 14, depth: 6 }, pan });
  } else if (kind === 'ground') {
    audio.burst({ t, type: 'lowpass', freq: 520, gain: 0.55 * gain, decay: 0.09, pan });
    audio.burst({ t, type: 'bandpass', freq: 3200, q: 1, gain: 0.12 * gain, decay: 0.03, pan });
    audio.tone({ t, type: 'sine', f0: 85, f1: 50, glide: 0.06, gain: 0.4 * gain, decay: 0.12, pan });
  } else {
    audio.burst({ t, type: 'lowpass', freq: 380, gain: 0.7 * gain, decay: 0.12, pan });
    audio.burst({ t, type: 'bandpass', freq: 950, q: 0.7, gain: 0.3 * gain, decay: 0.035, pan });
    audio.tone({ t, type: 'sine', f0: 110, f1: 55, glide: 0.08, gain: 0.5 * gain, decay: 0.16, pan });
  }
}

export function reload(audio: WeaponSynth): void {
  tap.sound?.('reload');
  if (!audio.ready || audio.shot('reload')) return;
  const t0 = audio.ctx.currentTime + 0.12;
  const n = 11;
  for (let i = 0; i < n; i++) {
    const t = t0 + (i / n) * 1.05 + rnd(-0.008, 0.008);
    const f = 2200 + i * 110;
    audio.burst({ t, type: 'bandpass', freq: f, q: 3, gain: 0.22 + i * 0.012, decay: 0.014 });
    audio.tone({ t, type: 'square', f0: 900 + i * 40, gain: 0.03, decay: 0.012, lowpass: 3000 });
    audio.tone({ t, type: 'sine', f0: 180, f1: 120, glide: 0.02, gain: 0.08, decay: 0.03 });
  }
  // string tension creak
  audio.tone({ t: t0, type: 'sawtooth', f0: 70, f1: 110, glide: 1.0, gain: 0.035, attack: 0.3, decay: 0.5, hold: 0.4, lowpass: 600, vibrato: { rate: 9, depth: 4 } });
  // final latch clack + bolt seated
  const tl = t0 + 1.12;
  audio.burst({ t: tl, type: 'bandpass', freq: 1400, q: 1.5, gain: 0.45, decay: 0.04 });
  audio.tone({ t: tl, type: 'sine', f0: 320, f1: 160, glide: 0.04, gain: 0.3, decay: 0.07 });
  audio.burst({ t: tl + 0.16, type: 'lowpass', freq: 900, gain: 0.2, decay: 0.05 });
}
