import type { ImpactKind } from '@wildshard/engine/audio/Audio';
import { tap } from '@wildshard/engine/core/harnessTap';
import type { WeaponSynth } from "../../plugin/audio";

export function swordSwing(audio: WeaponSynth): void {
  tap.sound?.('swordSwing');
  if (audio.cue('melee.swing')) return;
  if (!audio.ready || audio.shot('swordSwing')) return;
  const t = audio.ctx.currentTime;
  audio.burst({ t, type: 'bandpass', freq: 500, freqEnd: 2200, q: 0.6, gain: 0.32, attack: 0.05, decay: 0.09, rate: 1.1 });
  audio.burst({ t: t + 0.09, type: 'bandpass', freq: 2200, freqEnd: 700, q: 0.7, gain: 0.4, attack: 0.02, decay: 0.13 });
  audio.burst({ t: t + 0.02, type: 'lowpass', freq: 300, gain: 0.12, attack: 0.06, decay: 0.16 });
}

export function swordHeavy(audio: WeaponSynth): void {
  tap.sound?.('swordHeavy');
  if (audio.cue('melee.heavy')) return;
  if (!audio.ready || audio.shot('swordHeavy')) return;
  const t = audio.ctx.currentTime;
  audio.burst({ t, type: 'bandpass', freq: 220, freqEnd: 900, q: 0.8, gain: 0.45, attack: 0.09, decay: 0.22, rate: 0.9 });
  audio.burst({ t: t + 0.12, type: 'bandpass', freq: 1400, freqEnd: 380, q: 0.9, gain: 0.5, attack: 0.03, decay: 0.26 });
  audio.tone({ t: t + 0.02, type: 'sine', f0: 110, f1: 55, glide: 0.18, gain: 0.35, attack: 0.02, decay: 0.3 });
  audio.burst({ t: t + 0.05, type: 'lowpass', freq: 240, gain: 0.2, attack: 0.08, decay: 0.3 });
}

export function swordHit(audio: WeaponSynth, kind: ImpactKind = 'flesh', pan = 0, gain = 1): void {
  tap.sound?.(`swordHit:${kind}`);
  if (audio.cue('melee.hit', { surface: kind, pan, gain })) return;
  if (!audio.ready || audio.shot(kind === 'wood' ? 'swordHit-wood' : 'swordHit-flesh', { pan, gain })) return;
  const t = audio.ctx.currentTime;
  if (kind === 'wood') {
    audio.burst({ t, type: 'bandpass', freq: 1400, q: 2, gain: 0.5 * gain, decay: 0.05, pan });
    audio.tone({ t, type: 'triangle', f0: 520, f1: 300, glide: 0.05, gain: 0.25 * gain, decay: 0.1, pan });
  } else {
    audio.burst({ t, type: 'lowpass', freq: 420, gain: 0.7 * gain, decay: 0.11, pan });
    audio.burst({ t, type: 'bandpass', freq: 1100, q: 1, gain: 0.25 * gain, decay: 0.03, pan });
  }
  audio.tone({ t, type: 'sine', f0: 160, f1: 60, glide: 0.09, gain: 0.7 * gain, decay: 0.18, pan });
  audio.burst({ t: t + 0.004, type: 'highpass', freq: 2800, gain: 0.18 * gain, decay: 0.012, pan });
}
