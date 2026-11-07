import { uiScope, mountUi } from './ownership';
import { app } from '../app/runtime';
import { engineString } from '../../../shared/engine/strings';
import './styles/combat.css';
import type { DeathCause } from '../../../shared/engine/combat/pipeline';

/**
 * HurtArc — the "you were hit FROM THERE" indicator (DOM in `#hud`, styled in `src/client/engine/ui/styles/combat.css`, prefix
 * `ws-combat-hurt`): a red tapered arc on a ring around the crosshair, turned toward the attacker and kept turned as
 * you look around (re-aimed every frame from the camera yaw), fading over LIFE s. A hit from dead ahead lights the top
 * of the ring, from behind the bottom. Pooled (SLOTS arcs, the oldest recycled), no per-frame allocations.
 *
 *   const hurtArc = new HurtArc();
 *   hurtArc.hit(attacker.position.x, attacker.position.z, player.position, player.yaw, damage);   // on every hit taken
 *   game.onUpdate((dt) => hurtArc.update(dt, player.position, player.yaw));
 *
 * The hurt sound itself is `Audio.hurt(strength, pan)` (src/client/engine/audio/Audio.ts, B3).
 */

const SLOTS = 4;
const LIFE = 1.3;      // s an arc stays up (full for the first HOLD, then fades)
const HOLD = 0.35;

interface Slot { el: HTMLElement; x: number; z: number; t: number; strength: number; active: boolean }

export class HurtArc {
  readonly scope: ReturnType<typeof uiScope> = uiScope('HurtArc');
  private layer: HTMLElement;
  private slots: Slot[] = [];

  constructor() {
    this.layer = document.createElement('div');
    this.layer.className = 'ws-combat-hurt';
    for (let i = 0; i < SLOTS; i++) {
      const el = document.createElement('i');
      el.className = 'ws-combat-hurt-arc';
      this.layer.append(el);
      this.slots.push({ el, x: 0, z: 0, t: 0, strength: 0, active: false });
    }
    const hud = document.getElementById('hud');
    mountUi(this.layer, this.scope, hud ?? document.body, hud?.firstChild);
  }

  /** a hit from world (x, z); `damage` sizes the arc (8 → a thin one, 18+ → a thick one) */
  hit(x: number, z: number, player: { x: number; z: number }, yaw: number, damage: number): void {
    let s = this.slots.find((k) => !k.active);
    if (s === undefined) for (const k of this.slots) if (s === undefined || k.t > s.t) s = k; // recycle the oldest
    if (s === undefined) return;
    s.x = x; s.z = z; s.t = 0; s.active = true;
    s.strength = Math.min(1, 0.45 + damage / 30);
    s.el.style.setProperty('--ws-hurt-w', `${Math.round(34 + 40 * s.strength)}deg`);
    s.el.classList.add('show');
    this.aim(s, player, yaw);
  }

  update(dt: number, player: { x: number; z: number }, yaw: number): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      s.t += dt;
      if (s.t >= LIFE) { s.active = false; s.el.classList.remove('show'); continue; }
      this.aim(s, player, yaw);
    }
  }

  /** turn the arc toward the attacker: 0 = ahead (top), +90° = to the right */
  private aim(s: Slot, player: { x: number; z: number }, yaw: number): void {
    const dx = s.x - player.x, dz = s.z - player.z;
    // forward (-sin yaw, -cos yaw), right (cos yaw, -sin yaw) — Player.ts
    const fwd = -dx * Math.sin(yaw) - dz * Math.cos(yaw), right = dx * Math.cos(yaw) - dz * Math.sin(yaw);
    const deg = Math.atan2(right, fwd) * 180 / Math.PI;
    const k = s.t < HOLD ? 1 : 1 - (s.t - HOLD) / (LIFE - HOLD);
    s.el.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    s.el.style.opacity = (k * (0.55 + 0.45 * s.strength)).toFixed(3);
  }
}


/** who (or what) hurt you last: an animal (`Animal.kind` / `Animal.label`), or a cause with no attacker ("Struck by lightning") */

/**
 * where this shard puts you back (the death card's second line): `place` = the last named place you reached (E295,
 * src/game/LastPlace.ts `placeName`) when the shard has places and you have reached one; else the shard's spawn
 */
export function respawnWhere(_def: object, place?: string | null, defaultText?: string): string {
  if (place !== undefined && place !== null && place !== '') return engineString('s_cf847cd1dbbf', [place]);
  if (defaultText !== undefined) return defaultText;
  const registered = app.levelRegistrations.findText('respawn.default', app.levelScope ?? undefined);
  if (registered !== undefined) return registered;
  return engineString('s_d67d227883b6');
}


/** the death card's headline (E295): who or what killed you — "Mauled by a brown bear", "Fell too far" */
export function deathCause(killer: DeathCause | null): string {
  if (killer === null) return engineString('s_7c584bc86c44');
  if (killer.text !== undefined) return killer.text;
  const name = killer.label.trim() === '' ? killer.kind : killer.label.toLowerCase();
  const article = /^(the |a |an )/.test(name) ? '' : /^[aeiou]/.test(name) ? engineString('s_97e38d38d90f') : engineString('s_6583dcd6056f');
  // the level names how its creatures kill (ctx.strings 'death.verb.<kind>': "Gored by"); anything else is "Killed by"
  const verb = app.levelRegistrations.findText(`death.verb.${killer.kind}`, app.levelScope ?? undefined) ?? engineString('s_d82be891089d');
  return engineString('s_599cb23bbfef', [verb, article, name]);
}
