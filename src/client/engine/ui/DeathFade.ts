import { smoothstep } from '../../../shared/engine/core/noise';
import { uiScope, mountUi } from './ownership';
import { app } from '../app/runtime';
import './styles/combat.css';

/**
 * DeathFade — death on every shard's baseline HUD (E295, DRIFTWOOD-TOP10 row 4): the view fades to dark, a small glass
 * card says who killed you and where you come back ("Mauled by a brown bear" / "respawning at Wreck Cove"), the
 * respawn happens under the dark, and the view fades back in. DOM in `#hud`, styled in `src/client/engine/ui/styles/combat.css`
 * (prefix `ws-combat-death`). Driven by the game's dt, so a paused game holds the fade where it is.
 *
 *   const death = new DeathFade();
 *   death.play(deathCause(killer), respawnWhere(chunk, place), { dark: () => respawn(), done: () => unfreeze() });
 *   game.onUpdate((dt) => death.update(dt));
 *   death.active                  // true from play() to done: input frozen, no damage taken
 *
 * A boss fight's death (Nalati's King / Titan, Pine Hollow's Antler King) keeps its own checkpoint and never plays this.
 */

/** s: the fade to dark */
export const FADE_OUT = 0.5;
/** s: the view is fully dark from FADE_OUT to this; the respawn happens at FADE_OUT */
export const DARK_UNTIL = 1.2;
/** s: the fade back in */
export const FADE_IN = 0.6;
const CARD_IN = 0.15, CARD_ON = 0.4;
const END = DARK_UNTIL + FADE_IN;

export interface DeathHooks {
  /** fully dark: move the player to the respawn point */
  dark: () => void;
  /** the view is back: give the player their input back */
  done: () => void;
}


export class DeathFade {
  readonly scope: ReturnType<typeof uiScope> = uiScope('DeathFade');
  private readonly root: HTMLElement;
  private readonly cause: HTMLElement;
  private readonly where: HTMLElement;
  private readonly card: HTMLElement;
  private t = 0;
  private hooks: DeathHooks | null = null;
  private darkDone = false;

  constructor() {
    for (const old of document.querySelectorAll('.ws-combat-death')) old.remove(); // the last shard's (a shard switch builds a new one)
    this.root = document.createElement('div');
    this.root.className = 'ws-combat-death';
    this.root.setAttribute('aria-live', 'assertive');
    this.card = document.createElement('div');
    this.card.className = 'ws-combat-death-card';
    for (const c of ['tl', 'tr', 'bl', 'br']) { const i = document.createElement('i'); i.className = `cb ${c}`; this.card.append(i); }
    this.cause = document.createElement('div');
    this.cause.className = 'ws-combat-death-cause';
    const rule = document.createElement('div');
    rule.className = 'ws-combat-death-rule';
    this.where = document.createElement('div');
    this.where.className = 'ws-combat-death-where';
    this.card.append(this.cause, rule, this.where);
    this.root.append(this.card);
    mountUi(this.root, this.scope);
  }

  /** from play() until the view is back */
  get active(): boolean { return this.hooks !== null; }

  play(cause: string, where: string, hooks: DeathHooks): void {
    if (this.hooks !== null) return;
    this.cause.textContent = cause;
    this.where.textContent = where;
    this.hooks = hooks; this.t = 0; this.darkDone = false;
    app.setState('dead');
    this.root.classList.add('show');
    this.paint();
  }

  update(dt: number): void {
    const h = this.hooks;
    if (h === null) return;
    this.t += Math.min(dt, 0.1); // a long frame (a hitch, a tab switch) doesn't skip the card
    if (!this.darkDone && this.t >= FADE_OUT) { this.darkDone = true; h.dark(); }
    if (this.t >= END) {
      this.hooks = null;
      app.setState('play');
      this.root.classList.remove('show');
      this.root.style.opacity = '0';
      h.done();
      return;
    }
    this.paint();
  }

  private paint(): void {
    const t = this.t;
    const veil = t < FADE_OUT ? smoothstep(0, 1, t / FADE_OUT) : t < DARK_UNTIL ? 1 : 1 - smoothstep(0, 1, (t - DARK_UNTIL) / FADE_IN);
    const card = t < CARD_IN ? 0 : t < CARD_ON ? smoothstep(0, 1, (t - CARD_IN) / (CARD_ON - CARD_IN)) : t < DARK_UNTIL + 0.1 ? 1 : 1 - smoothstep(0, 1, (t - DARK_UNTIL - 0.1) / (FADE_IN - 0.15));
    this.root.style.opacity = '1';
    this.root.style.setProperty('--ws-death-veil', veil.toFixed(3));
    this.card.style.opacity = card.toFixed(3);
    this.card.style.transform = `translateY(${((1 - card) * 6).toFixed(1)}px)`;
  }
}
