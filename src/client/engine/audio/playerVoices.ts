import { Synth } from './synth';
import { audioRandom } from './util';
import { tap } from '../../../shared/engine/core/harnessTap';
import type { Voices } from './Voices';
import type { StepSurface } from './surface';
import type { CueOpts } from './Cues';

const rnd = (a: number, b: number): number => a + audioRandom() * (b - a);

/** Player movement, water, lock and feedback cues on the mixer's synth blocks. */
export abstract class PlayerVoices extends Synth {
  abstract readonly voices: Voices;
  abstract readonly ambient: GainNode;
  abstract cue(id: string, opts?: CueOpts): boolean;
  protected abstract shot(id: string, opts?: { pan?: number; gain?: number; out?: AudioNode; t?: number; rate?: number }): boolean;
  stepSurface: (() => StepSurface) | undefined;
  private stepSide = 1;
  /** a dodge (Player.onDodge): a body whoosh — lower and airier than a blade, a cloth flap, the scuff of the push-off */
  dodge(): void {
    tap.sound?.('dodge');
    if (!this.ready || this.shot('dodge')) return;
    const t = this.ctx.currentTime;
    this.burst({ t, type: 'bandpass', freq: 260, freqEnd: 1100, q: 0.5, gain: 0.34, attack: 0.03, decay: 0.16, rate: 1.2 });
    this.burst({ t: t + 0.04, type: 'highpass', freq: 3200, gain: 0.08, attack: 0.01, decay: 0.07 });
    this.burst({ t, type: 'lowpass', freq: 520, gain: 0.26, decay: 0.05 });
  }

  /** a lunge (Player.onLunge, under the swing's whoosh): a short low rush of closing distance */
  lunge(): void {
    tap.sound?.('lunge');
    if (!this.ready || this.shot('lunge')) return;
    const t = this.ctx.currentTime;
    this.burst({ t, type: 'bandpass', freq: 180, freqEnd: 620, q: 0.6, gain: 0.3, attack: 0.02, decay: 0.12, rate: 1.4 });
    this.tone({ t, type: 'sine', f0: 90, f1: 60, glide: 0.1, gain: 0.18, attack: 0.01, decay: 0.12 });
  }

  /** weapon swap: sling rustle as one drops, a strap snap and the other's grip clack as it comes up */
  weaponSwap(): void {
    tap.sound?.('weaponSwap');
    if (!this.ready || this.shot('weaponSwap')) return;
    const t = this.ctx.currentTime;
    this.burst({ t, type: 'bandpass', freq: 900, freqEnd: 1600, q: 0.5, gain: 0.16, attack: 0.03, decay: 0.2 });
    this.burst({ t: t + 0.22, type: 'highpass', freq: 3000, gain: 0.18, decay: 0.012 });
    this.burst({ t: t + 0.30, type: 'bandpass', freq: 1800, freqEnd: 2600, q: 0.5, gain: 0.14, attack: 0.02, decay: 0.16 });
    this.burst({ t: t + 0.46, type: 'bandpass', freq: 1300, q: 1.5, gain: 0.3, decay: 0.035 });
    this.tone({ t: t + 0.46, type: 'sine', f0: 220, f1: 130, glide: 0.04, gain: 0.2, decay: 0.06 });
  }

  /** the item-pickup orb's hum while the player stands inside its prompt radius (WeaponPickup.onNear): a low-passed
   *  220 Hz sine with a 5.5 Hz tremolo and a faint fifth, looped, faded in over 0.35 s and out over 0.5 s */
  footstep(sprinting: boolean, requestedSurface: StepSurface = 'litter'): void {
    const surface = this.stepSurface?.() ?? requestedSurface;
    if (this.cue('step', { surface, sprinting })) return;
    tap.sound?.(`footstep:${surface}`);
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.stepSide = -this.stepSide;
    const pan = this.stepSide * 0.14;
    if (this.shot(`footstep-${surface}`, { pan, gain: sprinting ? 1 : 0.7 })) return;
    if (surface === 'planks') {
      // a boot on a pier deck: a hollow wooden knock that rings down the planks, a hint of a creak
      this.burst({ t, type: 'bandpass', freq: rnd(220, 320), q: 1.6, gain: sprinting ? 0.55 : 0.38, decay: sprinting ? 0.09 : 0.12, pan });
      this.tone({ t, type: 'triangle', f0: rnd(150, 190), f1: 90, glide: 0.07, gain: sprinting ? 0.3 : 0.2, decay: 0.11, pan, lowpass: 900 });
      this.tone({ t, type: 'sine', f0: rnd(60, 75), f1: 40, glide: 0.06, gain: sprinting ? 0.35 : 0.22, decay: 0.09, pan });
      if (audioRandom() < 0.25) this.tone({ t: t + 0.03, type: 'sawtooth', f0: rnd(400, 700), f1: rnd(300, 500), glide: 0.12, gain: 0.03, attack: 0.03, decay: 0.12, pan, lowpass: 1400, vibrato: { rate: 18, depth: 20 } });
      return;
    }
    if (surface === 'grass') {
      // Turf: a soft swish of blades round the boot over a dull earth thud — no needle crunch
      this.burst({ t, type: 'bandpass', freq: rnd(2600, 3800), freqEnd: 1600, q: 0.6, gain: sprinting ? 0.16 : 0.1, attack: 0.025, decay: sprinting ? 0.11 : 0.15, pan });
      this.burst({ t, type: 'lowpass', freq: rnd(300, 420), gain: sprinting ? 0.38 : 0.24, attack: 0.008, decay: 0.07, pan });
      this.tone({ t, type: 'sine', f0: rnd(62, 80), f1: 42, glide: 0.05, gain: sprinting ? 0.24 : 0.15, decay: 0.07, pan });
      return;
    }
    if (surface === 'gravel') {
      // a road / a gravel bar: a gritty crunch of small stones, a few rattling grains after it
      this.burst({ t, type: 'bandpass', freq: rnd(1500, 2400), q: 1.1, gain: sprinting ? 0.3 : 0.2, attack: 0.004, decay: sprinting ? 0.07 : 0.09, pan });
      for (let i = 0; i < 3; i++) this.burst({ t: t + 0.01 + rnd(0, 0.05), type: 'bandpass', freq: rnd(2500, 4500), q: 4, gain: rnd(0.03, 0.07), decay: 0.025, pan });
      this.burst({ t, type: 'lowpass', freq: 460, gain: sprinting ? 0.34 : 0.22, decay: 0.06, pan });
      this.tone({ t, type: 'sine', f0: rnd(68, 88), f1: 44, glide: 0.05, gain: sprinting ? 0.24 : 0.15, decay: 0.06, pan });
      return;
    }
    if (surface === 'sand') {
      // a soft grainy scuff, no knock: broadband hiss that swells and settles, a dull thud under it
      this.burst({ t, type: 'bandpass', freq: rnd(1400, 2200), freqEnd: 700, q: 0.5, gain: sprinting ? 0.3 : 0.2, attack: 0.02, decay: sprinting ? 0.1 : 0.14, pan });
      this.burst({ t: t + 0.01, type: 'lowpass', freq: 380, gain: sprinting ? 0.32 : 0.2, attack: 0.012, decay: 0.09, pan });
      this.tone({ t, type: 'sine', f0: rnd(60, 80), f1: 42, glide: 0.06, gain: sprinting ? 0.18 : 0.1, decay: 0.07, pan });
      return;
    }
    if (surface === 'mud' || surface === 'wet') {
      // a squelch: a dull low thud, a wet mid smack that slides down, a little suck after it (mud) — no crunch
      this.burst({ t, type: 'lowpass', freq: 420, gain: sprinting ? 0.42 : 0.28, attack: 0.008, decay: 0.08, pan });
      this.burst({ t: t + 0.01, type: 'bandpass', freq: rnd(900, 1300), freqEnd: 500, q: 1.4, gain: sprinting ? 0.22 : 0.15, decay: 0.07, pan });
      if (surface === 'mud') this.burst({ t: t + 0.12, type: 'bandpass', freq: rnd(600, 800), q: 2, gain: 0.08, attack: 0.02, decay: 0.08, pan });
      return;
    }
    if (surface === 'rock') {
      // boot on granite: a hard gritty click on a short low knock
      this.burst({ t, type: 'bandpass', freq: rnd(2600, 3400), q: 1.2, gain: sprinting ? 0.3 : 0.2, decay: 0.03, pan });
      this.tone({ t, type: 'sine', f0: rnd(90, 120), f1: 60, glide: 0.04, gain: sprinting ? 0.28 : 0.18, decay: 0.06, pan });
      return;
    }
    const f = rnd(380, 720);
    this.burst({ t, type: 'lowpass', freq: f, gain: sprinting ? 0.5 : 0.32, decay: sprinting ? 0.06 : 0.08, pan });
    // needle-litter crunch
    this.burst({ t: t + 0.006, type: 'bandpass', freq: rnd(1800, 3200), q: 0.8, gain: sprinting ? 0.14 : 0.09, decay: 0.045, pan });
    this.tone({ t, type: 'sine', f0: rnd(70, 95), f1: 45, glide: 0.05, gain: sprinting ? 0.3 : 0.18, decay: 0.07, pan });
  }

  jump(): void {
    tap.sound?.('jump');
    if (!this.ready || this.shot('jump')) return;
    const t = this.ctx.currentTime;
    this.burst({ t, type: 'bandpass', freq: 400, freqEnd: 1400, q: 0.6, gain: 0.16, attack: 0.02, decay: 0.16 });
    this.burst({ t, type: 'lowpass', freq: 500, gain: 0.25, decay: 0.05 });
  }

  land(hard: boolean): void {
    tap.sound?.('land');
    if (!this.ready || this.shot(hard ? 'land-hard' : 'land')) return;
    const t = this.ctx.currentTime;
    this.burst({ t, type: 'lowpass', freq: hard ? 380 : 500, gain: hard ? 0.8 : 0.45, decay: hard ? 0.16 : 0.09 });
    this.tone({ t, type: 'sine', f0: hard ? 75 : 85, f1: 40, glide: 0.08, gain: hard ? 0.7 : 0.35, decay: hard ? 0.22 : 0.12 });
    this.burst({ t: t + 0.01, type: 'bandpass', freq: 2400, q: 0.8, gain: 0.12, decay: 0.05 });
    if (hard) this.burst({ t: t + 0.06, type: 'lowpass', freq: 300, gain: 0.3, decay: 0.12 });
  }

  // ─────────────── water (wading / swimming) ───────────────
  /** feet break the surface. `impact` = entry speed m/s: ~0–1 walking in (a slosh), 10+ off the pier (a full plunge with a spray tail) */
  splash(impact = 0): void {
    tap.sound?.('splash');
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const k = Math.min(1, impact / 10);            // 0 = stepping in, 1 = a dive off the pier
    if (this.shot('splash', { gain: 0.35 + 0.65 * k })) return;
    // the body of the splash: a low "gloop" plus a mid slap that scales with how hard we hit
    this.tone({ t, type: 'sine', f0: 160 + 60 * k, f1: 45, glide: 0.12 + 0.08 * k, gain: 0.25 + 0.55 * k, attack: 0.008, decay: 0.2 + 0.2 * k });
    this.burst({ t, type: 'lowpass', freq: 700 + 900 * k, freqEnd: 180, gain: 0.35 + 0.6 * k, attack: 0.004, decay: 0.12 + 0.18 * k });
    // spray: bright noise that opens up after the hit and rains back down
    this.burst({ t: t + 0.02, type: 'bandpass', freq: 2600, freqEnd: 1100, q: 0.5, gain: 0.12 + 0.45 * k, attack: 0.03 + 0.03 * k, decay: 0.3 + 0.5 * k });
    if (k > 0.35) {
      // droplets pattering back onto the surface
      for (let i = 0; i < 5 + Math.floor(k * 6); i++) {
        const ti = t + 0.25 + rnd(0, 0.55) * (0.5 + k);
        this.burst({ t: ti, type: 'bandpass', freq: rnd(1800, 4200), q: 3, gain: rnd(0.03, 0.09) * k, decay: rnd(0.02, 0.05), pan: rnd(-0.6, 0.6) });
      }
    }
  }

  /** a footstep in shallow water: the crunch of the dry step is replaced by a slosh that deepens with the water */
  wadeStep(depth: number, sprinting = false): void {
    tap.sound?.('wadeStep');
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.stepSide = -this.stepSide;
    const pan = this.stepSide * 0.14;
    const d = Math.min(1, depth / 1.1);
    if (this.shot('wadeStep', { pan, gain: (sprinting ? 1 : 0.7) * (0.6 + 0.4 * d) })) return;
    this.burst({ t, type: 'lowpass', freq: 900 - 400 * d, freqEnd: 250, gain: (sprinting ? 0.42 : 0.28) * (0.6 + 0.6 * d), attack: 0.006, decay: 0.09 + 0.1 * d, pan });
    this.burst({ t: t + 0.01, type: 'bandpass', freq: rnd(1900, 3000), freqEnd: 1200, q: 0.7, gain: 0.08 + 0.14 * d, attack: 0.015, decay: 0.12 + 0.12 * d, pan });
    this.tone({ t, type: 'sine', f0: rnd(90, 130), f1: 50, glide: 0.07, gain: 0.12 + 0.12 * d, decay: 0.09, pan });
  }

  /** one swim stroke: an arm sweeping through the water, a soft wash off to one side */
  swimStroke(): void {
    tap.sound?.('swimStroke');
    if (!this.ready || this.shot('swimStroke')) return;
    const t = this.ctx.currentTime;
    this.stepSide = -this.stepSide;
    const pan = this.stepSide * 0.35;
    this.burst({ t, type: 'bandpass', freq: rnd(500, 700), freqEnd: 1400, q: 0.6, gain: 0.16, attack: 0.09, decay: 0.28, pan });
    this.burst({ t: t + 0.06, type: 'bandpass', freq: 2400, freqEnd: 1300, q: 0.8, gain: 0.07, attack: 0.05, decay: 0.22, pan });
    this.tone({ t, type: 'sine', f0: 110, f1: 70, glide: 0.2, gain: 0.06, attack: 0.05, decay: 0.2, pan });
  }

  /** climbing / wading out: water sheeting off and a few drips */
  waterExit(): void {
    tap.sound?.('waterExit');
    if (!this.ready || this.shot('waterExit')) return;
    const t = this.ctx.currentTime;
    this.burst({ t, type: 'bandpass', freq: 1200, freqEnd: 500, q: 0.6, gain: 0.16, attack: 0.02, decay: 0.3 });
    for (let i = 0; i < 4; i++) this.burst({ t: t + 0.15 + rnd(0, 0.5), type: 'bandpass', freq: rnd(2200, 4000), q: 4, gain: rnd(0.02, 0.05), decay: 0.03, pan: rnd(-0.4, 0.4) });
  }

  // ─────────────── diving (Player.onSubmerge / onSurface) ───────────────
  /** the head goes under: a soft whump of water closing over the ears and a trail of bubbles */
  dive(): void {
    tap.sound?.('dive');
    if (!this.ready || this.shot('dive')) return;
    const t = this.ctx.currentTime;
    this.tone({ t, type: 'sine', f0: 140, f1: 40, glide: 0.25, gain: 0.35, attack: 0.02, decay: 0.35 });
    this.burst({ t, type: 'lowpass', freq: 900, freqEnd: 160, gain: 0.4, attack: 0.02, decay: 0.32 });
    for (let i = 0; i < 9; i++) {
      const ti = t + 0.08 + rnd(0, 0.7);
      this.tone({ t: ti, type: 'sine', f0: rnd(420, 900), f1: rnd(900, 1800), glide: 0.06, gain: rnd(0.02, 0.05), attack: 0.004, decay: rnd(0.03, 0.07), pan: rnd(-0.5, 0.5) });
    }
  }

  /** breaking the surface: water sheeting off the head, a gasp of air, a couple of drips */
  surface(): void {
    tap.sound?.('surface');
    if (!this.ready || this.shot('surface')) return;
    const t = this.ctx.currentTime;
    this.burst({ t, type: 'bandpass', freq: 1400, freqEnd: 500, q: 0.6, gain: 0.34, attack: 0.01, decay: 0.28 });
    this.burst({ t: t + 0.03, type: 'lowpass', freq: 1200, freqEnd: 300, gain: 0.22, attack: 0.01, decay: 0.16 });
    // the gasp: a breathy inhale (bandpassed noise sweeping up) then a short exhale
    this.burst({ t: t + 0.12, type: 'bandpass', freq: 700, freqEnd: 1900, q: 1.4, gain: 0.13, attack: 0.16, decay: 0.12, hold: 0.05 });
    this.burst({ t: t + 0.5, type: 'bandpass', freq: 1500, freqEnd: 600, q: 1.1, gain: 0.07, attack: 0.05, decay: 0.2 });
    for (let i = 0; i < 4; i++) this.burst({ t: t + 0.2 + rnd(0, 0.5), type: 'bandpass', freq: rnd(2200, 4000), q: 4, gain: rnd(0.02, 0.05), decay: 0.03, pan: rnd(-0.4, 0.4) });
  }

  /** under the surface everything is muffled (master lowpass down to ~500 Hz) under a low pressure hum with the odd bubble */
  hitMarker(): void {
    tap.sound?.('hitMarker');
    if (!this.ready || this.shot('hitMarker')) return;
    const t = this.ctx.currentTime;
    this.tone({ t, type: 'sine', f0: 1900, gain: 0.16, decay: 0.045 });
    this.tone({ t: t + 0.012, type: 'sine', f0: 2600, gain: 0.1, decay: 0.05 });
  }

  /** the player takes a hit (both shards, B3): a short grunt ("uh" / "ah" / "oof") over a body blow, from the bank (gen.ts
   *  hurt). `strength` ≈ dmg / 20 (0.1 … 1.5): louder and a little lower / heavier as it grows; `pan` −1 … 1 toward the attacker. */
  hurt(strength = 0.5, pan = 0): void {
    tap.sound?.('hurt');
    if (this.cue('hurt', { strength, pan })) return;
    if (!this.ready) return;
    const s = Math.max(0.1, Math.min(1, strength));
    this.voices.play('hurt', { gain: 0.45 + 0.4 * s, rate: 1.05 - 0.12 * s, pan: Math.max(-1, Math.min(1, pan)) * 0.6 });
  }

  /** the player dies (both shards): the hit, a groan falling out of breath, the body hitting the ground (~1.6 s) */
  death(): void {
    tap.sound?.('death');
    if (!this.ready) return;
    this.voices.play('death', { gain: 0.85, jitter: 0.03 });
  }

  /** lock-on (E50, src/client/engine/player/LockOnTarget.ts): a short bright two-note chime on LOCK (the Navi "ping" idea, no voice) */
  lockOn(): void {
    tap.sound?.('lockOn');
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    this.tone({ t, type: 'sine', f0: 1320, gain: 0.12, decay: 0.08 });
    this.tone({ t: t + 0.06, type: 'sine', f0: 1980, gain: 0.13, decay: 0.16 });
    this.tone({ t: t + 0.06, type: 'triangle', f0: 3960, gain: 0.025, decay: 0.12 });
  }
  /** lock-on: a softer single ping when the lock switches to another enemy */
  lockSwitch(): void {
    tap.sound?.('lockSwitch');
    if (!this.ready) return;
    this.tone({ t: this.ctx.currentTime, type: 'sine', f0: 1660, gain: 0.09, decay: 0.1 });
  }
  /** lock-on: a low falling tone when the lock is released or breaks */
  lockOff(): void {
    tap.sound?.('lockOff');
    if (!this.ready) return;
    this.tone({ t: this.ctx.currentTime, type: 'sine', f0: 880, f1: 520, glide: 0.1, gain: 0.08, decay: 0.14 });
  }
  /** lock-on: a dull tick — LOCK with nothing lockable, or a flick with nothing on that side */
  lockNone(): void {
    tap.sound?.('lockNone');
    if (!this.ready) return;
    this.burst({ t: this.ctx.currentTime, type: 'bandpass', freq: 900, q: 2, gain: 0.07, decay: 0.035 });
  }

  kill(): void {
    tap.sound?.('kill');
    if (!this.ready || this.shot('kill')) return;
    const t = this.ctx.currentTime;
    this.tone({ t, type: 'sine', f0: 660, gain: 0.18, decay: 0.16 });
    this.tone({ t: t + 0.09, type: 'sine', f0: 990, gain: 0.2, decay: 0.32 });
    this.tone({ t: t + 0.09, type: 'triangle', f0: 1980, gain: 0.05, decay: 0.3 });
    this.burst({ t, type: 'bandpass', freq: 1200, q: 0.5, gain: 0.08, attack: 0.05, decay: 0.3 });
  }

  // ─────────────── positional animal sounds ───────────────
  /** distance attenuation + stereo pan from direction relative to the listener yaw */
}
