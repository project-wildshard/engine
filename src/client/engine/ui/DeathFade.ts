import { smoothstep } from '../../../shared/engine/core/noise';
import { uiScope, mountUi } from './ownership';
import { app } from '../app/runtime';
import { listenPage, listenTap } from '../input/dom';
import './styles/combat.css';

/**
 * DeathFade — death on every shard's baseline HUD (E295, DRIFTWOOD-TOP10 row 4): the view fades to dark, a small glass
 * card says who killed you and where you come back ("Mauled by a brown bear" / "respawning at Wreck Cove"), the
 * respawn happens under the dark, and the view fades back in. DOM in `#hud`, styled in `src/client/engine/ui/styles/combat.css`
 * (prefix `ws-combat-death`). Driven by the game's dt, so a paused game holds the fade where it is.
 *
 *   const death = new DeathFade({ now: 'Respawn now', waiting: 'Respawning…' });
 *   death.play(deathCause(killer), respawnWhere(chunk, place), { dark: () => respawn(), done: () => unfreeze() });
 *   game.onUpdate((dt) => death.update(dt));
 *   death.active                  // true from play() to done: input frozen, no damage taken
 *
 * QA 11-13 (Jake, Sky Reach on an iPhone: "Respawning when you fell, that modal took forever. It needs a button, a Respawn now
 * button"): the card carries a Respawn now button (a tap, or Enter / Space on a keyboard). It runs `dark` at once and fades back
 * in over `SKIP_IN`. `ready` (optional) says whether the respawn point can take the player yet: until it does, neither the
 * timer nor the button respawns, and the button says it is waiting and fires the moment it can (never longer than `READY_WAIT`).
 * The wait itself is only what the card needs: 0.35 s to dark, the card readable to 0.9 s, back by 1.35 s (was 1.8 s).
 *
 * A boss fight's death (Nalati's King / Titan, Pine Hollow's Antler King) keeps its own checkpoint and never plays this.
 */

/** s: the fade to dark (hides the respawn's jump) */
export const FADE_OUT = 0.35;
/** s: the view is fully dark from FADE_OUT to this, the card readable; the respawn happens at FADE_OUT */
export const DARK_UNTIL = 0.9;
/** s: the fade back in */
export const FADE_IN = 0.45;
/** s: the fade back in after Respawn now */
export const SKIP_IN = 0.2;
/** s: the longest the dark waits on a respawn point that is not ready, before it respawns anyway (the old fade waited for nothing) */
export const READY_WAIT = 3;
/** s: the most one frame advances the fade: a hitch can't skip the card, and a 4 fps phone still sees it end on time */
const MAX_STEP = 0.25;
const CARD_IN = 0.15, CARD_ON = 0.4;
const END = DARK_UNTIL + FADE_IN;

export interface DeathHooks {
  /** fully dark: move the player to the respawn point */
  dark: () => void;
  /** the view is back: give the player their input back */
  done: () => void;
  /** whether the respawn point can take the player yet (absent: always) */
  ready?: () => boolean;
  /** Respawn now has respawned the player: a server's world ends its own fade too (RESPAWN_NOW_ACT), or its commands stay held */
  skipped?: () => void;
}

/** The Respawn now button's words. The game passes them in: the engine's string table rides in the title chunk, this card never does. */
export interface DeathLabels {
  /** the button: "Respawn now" */
  now: string;
  /** the button while the respawn point is not ready: "Respawning…" */
  waiting: string;
}


export class DeathFade {
  readonly scope: ReturnType<typeof uiScope> = uiScope('DeathFade');
  private readonly root: HTMLElement;
  private readonly cause: HTMLElement;
  private readonly where: HTMLElement;
  private readonly card: HTMLElement;
  private readonly now: HTMLButtonElement;
  private t = 0;
  /** time runs this many times faster: the fade back in after Respawn now */
  private rate = 1;
  private hooks: DeathHooks | null = null;
  private darkDone = false;
  /** Respawn now was pressed and has not respawned yet */
  private asked = false;
  /** s the dark has waited on a respawn point that is not ready */
  private waited = 0;

  private readonly labels: DeathLabels;

  constructor(labels: DeathLabels) {
    this.labels = labels;
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
    this.now = document.createElement('button');
    this.now.type = 'button';
    this.now.className = 'ws-combat-death-now';
    this.now.textContent = labels.now;
    this.card.append(this.cause, rule, this.where, this.now);
    this.root.append(this.card);
    mountUi(this.root, this.scope);
    listenTap(this.scope, this.now, () => { this.respawnNow(); }); // an iOS tap answers on its pointerup, not the late click
    // a keyboard: Enter or Space, first in the capture phase so neither reaches the game (a jump) or scrolls; a held key's repeat is not a press
    // Only the game's own keys (the page, the canvas, this button): a focused button on a card over this one (the pause menu, a
    // failure card) keeps its Enter and Space. Not before the card shows, so a Space tapped during the fall never skips it unseen.
    listenPage(this.scope, 'keydown', (e) => {
      if (this.hooks === null || e.repeat || app.clock.paused || this.t < CARD_IN) return;
      if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
      const at = e.target;
      if (at instanceof Element && at !== this.now && at !== document.body && at !== document.documentElement && !(at instanceof HTMLCanvasElement)) return;
      e.preventDefault(); e.stopPropagation();
      this.respawnNow();
    }, { capture: true });
  }

  /** Respawn now (the button, Enter, Space): respawn as soon as the point is ready, then a short fade back in. */
  respawnNow(): void {
    if (this.hooks === null) return;
    this.asked = true;
    this.tryDark();
    this.paintButton();
    this.paint();
  }

  /** the respawn under the dark, once the point is ready (or has kept the dark waiting READY_WAIT); after a press, the short way back */
  private tryDark(): void {
    const h = this.hooks;
    if (h === null) return;
    if (!this.darkDone) {
      if (!this.asked && this.t < FADE_OUT) return;
      if (h.ready?.() === false && this.waited < READY_WAIT) return;
      this.darkDone = true; h.dark();
    }
    if (this.asked) { this.asked = false; this.t = Math.max(this.t, DARK_UNTIL); this.rate = FADE_IN / SKIP_IN; h.skipped?.(); }
  }

  private paintButton(): void {
    const waiting = this.asked && !this.darkDone;
    this.now.classList.toggle('waiting', waiting);
    this.now.setAttribute('aria-busy', String(waiting));
    this.now.textContent = waiting ? this.labels.waiting : this.labels.now;
    this.now.disabled = this.darkDone && this.rate !== 1;
  }

  /** from play() until the view is back */
  get active(): boolean { return this.hooks !== null; }

  play(cause: string, where: string, hooks: DeathHooks): void {
    if (this.hooks !== null) return;
    this.cause.textContent = cause;
    this.where.textContent = where;
    this.hooks = hooks; this.t = 0; this.darkDone = false; this.asked = false; this.rate = 1; this.waited = 0;
    app.setState('dead');
    this.root.classList.add('show');
    this.paintButton();
    this.paint();
  }

  update(dt: number): void {
    const h = this.hooks;
    if (h === null) return;
    const step = Math.min(dt, MAX_STEP); // a long frame (a hitch, a tab switch) doesn't skip the card
    this.t += step * this.rate;
    if (!this.darkDone) {
      if (this.t >= FADE_OUT) this.waited += step;
      const asked = this.asked;
      this.tryDark();
      if (asked) this.paintButton();
      if (!this.darkDone) this.t = Math.min(this.t, DARK_UNTIL); // no fade back in before the respawn: the dark holds while the point is not ready
    }
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
