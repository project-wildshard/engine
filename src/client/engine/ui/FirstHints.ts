import { mountUi } from './ownership';
import { listenPage } from '../input/dom';
import { app } from '../app/runtime';
import { engineString } from '../../../shared/engine/strings';
import { saveStorage } from '../saves/slots';
import './styles/hints.css';
import type { Player } from '../player/Player';
import { lockOn } from '../player/AimTargets';
import { foldKeys } from '../input/bindingTable';
import { keycap } from '../input/keycap';
import type { Action } from '../input/InputService';

const savedStorage = saveStorage('global');

/**
 * FirstHints — first-time control hints, every shard's one system (E308, DRIFTWOOD-TOP10 row 5; Jake's pick A from
 * art/onboarding/round-1-first-minutes/board-1-hint-look.jpg): the first time a control matters, a short label ("DRAG TO
 * MOVE", "TAP TO ATTACK") and a pulsing ring sit ON that very touch control. Each control's hint shows once: it goes the
 * moment the player uses the control (saved in localStorage `hints`, per device, not per shard — a control learnt
 * on one shard is known on the next), never while paused or before ENTER WORLD, and a hint that has been up for
 * MAX_SHOWN seconds without the control being used retires anyway, so nothing nags.
 *
 * The system owns WHAT each control looks like and WHEN it counts as used; a shard owns only WHEN each control matters
 * (its `feed`, in priority order — the first trigger that wants to show wins; Driftwood's are
 * src/shards/driftwood-isle/firstMinutes.ts). Desktop gets the same hints with the key ("W A S D TO MOVE") under the
 * crosshair instead of on a button.
 *
 *   const hints = new FirstHints(player, { touch: touchControls.active, paused: () => !hud.entered || hud.paused });
 *   hints.feed([{ control: 'move', when: () => true }, { control: 'use', when: () => talkPromptUp(), touch: 'Tap to talk', desk: 'E to talk' }]);
 *   game.onUpdate((dt) => { hints.update(dt); });
 *   hints.used('attack');   // a use the system cannot see itself (it already sees the touch controls, the keys, jump and dodge)
 *
 * Styles: src/client/engine/ui/styles/hints.css (prefix `ws-hint-`); the ring pulses on touch.css's E286 `ws-touch-hint-pulse`, the
 * traversal-verb discs' own pulse, so a hint reads like the button it sits on.
 */

export type HintControl = 'move' | 'jump' | 'attack' | 'lock' | 'dodge' | 'use';

export interface HintTrigger {
  control: HintControl;
  /** polled every frame while the control's hint is still unseen: true = it matters now */
  when: () => boolean;
  /** the words over the touch control (default: HINT_TOUCH) — the first word is lit cyan */
  touch?: string;
  /** the words under the crosshair on a desktop (default: deskHint, the player's own keys) */
  desk?: string;
}

export interface FirstHintsOptions {
  /** the touch layer is up (TouchControls.active): the hints anchor on its buttons; false = the desktop line */
  touch: boolean;
  /** true while the world is not being played (title, pause menu, death fade, a practice room): nothing shows */
  paused: () => boolean;
}

const HINT_TOUCH: Record<HintControl, string> = {
  move: engineString('s_f9408bf8e7a8'), jump: engineString('s_cb601147eb2e'), attack: engineString('s_061a2f9cac0f'), lock: engineString('s_4da52d13f9ab'), dodge: engineString('s_5bffb8c39729'), use: engineString('s_cbd3c26b4566'),
};
/** KP1 (Jake 2026-11-09, on a Mac: "It says press Alt to dodge ... So Alt is not a thing"): the desktop line names the
 *  player's own keys for the action, in their platform's words ("V / ⌥ Option to dodge" on a Mac, "V / Alt" elsewhere) */
const DESK_KEYS = { jump: 's_hint_jump_keys', lock: 's_hint_lock_keys', dodge: 's_hint_dodge_keys', use: 's_hint_use_keys' } as const;
const DESK_FIXED = { move: 's_08cd5b7c05ad', attack: 's_dcc07bd2df54' } as const;
/** an action's bound keyboard and mouse keys, from the first registered context that binds it, as keycaps */
export function boundKeycaps(action: Action): string {
  const bindings = app.input.bindings;
  for (const context of bindings.contexts()) {
    const keys = foldKeys(bindings.keys(context)[action] ?? []);
    if (keys.length > 0) return keys.map(keycap).join(engineString('s_keys_or'));
  }
  return '';
}
export function deskHint(control: HintControl): string {
  if (control === 'move' || control === 'attack') return engineString(DESK_FIXED[control]);
  const keys = boundKeycaps(control);
  return engineString(DESK_KEYS[control], [keys === '' ? engineString('s_keys_none') : keys]);
}
/** the touch control each hint sits on (TouchControls.ts' markup) */
const ANCHOR: Record<HintControl, string> = {
  move: '.ws-touch-stick', jump: '.ws-touch-disc.jump', attack: '.ws-touch-attack', lock: '.ws-touch-disc.lock', dodge: '.ws-touch-disc.dodge', use: '.ws-touch-use',
};
/** controls the tag must not cover while it finds its spot */
const OBSTACLES = '.ws-touch-disc, .ws-touch-attack, .ws-touch-hover, .ws-touch-swap, .ws-touch-use.show';
/** A14: the online page's chat row over MOVE (src/client/host/online/chatLines.ts) is one too, though it lives outside the layer */
const PAGE_OBSTACLES = '#ws-chat > form';
/** the keys that use a control on a desktop (jump and dodge come through the player's own hooks) */

const STORE = 'hints';
/** metres walked from the first frame in that count as having moved */
const MOVED = 3;
/** seconds a hint may be up in all without the control being used before it retires */
const MAX_SHOWN = 20;
/** a hint on screen keeps its place this long before a lower-priority… or any other trigger takes over */
const MIN_SHOWN = 0.8;
/** px: the ring's gap around its control, the tag's gap above it, the screen margin */
const RING_PAD = 7, TAG_GAP = 12, MARGIN = 8;
/** s between re-measurings of the anchor (layout reads are not free; the controls do not move while shown) */
const MEASURE_EVERY = 0.25;

function loadSeen(): Set<HintControl> {
  try {
    const raw = savedStorage.getItem(STORE);
    const v: unknown = raw === null ? [] : JSON.parse(raw);
    const all = new Set<string>(Object.keys(HINT_TOUCH));
    return new Set(Array.isArray(v) ? v.filter((x): x is HintControl => typeof x === 'string' && all.has(x)) : []);
  } catch { return new Set(); }
}

interface Box { l: number; t: number; r: number; b: number }
/** drawn and seen: a box on screen, not faded out (E319's idle LOCK disc keeps its box but goes `opacity: 0; visibility:
 *  hidden` while nothing is lockable) — a hint never points at, or steps around, a control the player cannot see */
function shown(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== 'hidden' && Number.parseFloat(cs.opacity) > 0.05;
}
const overlaps = (a: Box, b: Box): boolean => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

export class FirstHints {
  private readonly seen = loadSeen();
  private triggers: HintTrigger[] = [];
  private readonly ring: HTMLElement;
  private readonly tag: HTMLElement;
  private readonly words: HTMLElement;
  private current: HintTrigger | null = null;
  private shownT = 0; // s the current hint has been up this time
  private readonly shownAll = new Map<HintControl, number>();
  private measureT = 0;
  /** each control's anchor, looked up at most once a MEASURE_EVERY: every unseen trigger's per-frame box and computed
   *  style read forced a layout each frame (~10 ms a second of a phone-4x Nine drive) */
  private readonly anchors = new Map<HintControl, HTMLElement | null | undefined>();
  private lookT = 0;
  private origin: { x: number; z: number } | null = null;
  private walked = 0;
  private last = { x: 0, z: 0 };

  private readonly player: Player;
  private readonly opts: FirstHintsOptions;
  constructor(player: Player, opts: FirstHintsOptions) {
    this.player = player;
    this.opts = opts;
    const scope = (app.levelScope ?? app.engineScope).child('input.hints');
    this.ring = document.createElement('div');
    this.ring.className = 'ws-hint-ring';
    this.tag = document.createElement('div');
    this.tag.className = `ws-glass ws-hint-tag${opts.touch ? '' : ' desk'}`;
    this.words = document.createElement('span');
    this.tag.append(this.words, document.createElement('i'));
    mountUi(this.ring, scope); mountUi(this.tag, scope);

    // ── uses the system sees for itself: a touch on the control, its key, the player's jump / dodge ──
    scope.onDispose(() => { this.ring.remove(); this.tag.remove(); });
    listenPage(scope, 'pointerdown', (e) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      for (const c of Object.keys(ANCHOR) as HintControl[]) if (c !== 'move' && t.closest(ANCHOR[c]) !== null) this.used(c);
    }, { capture: true, on: 'document' });
    for (const control of ['attack', 'lock', 'use'] as const) app.input.bind(control, () => { this.used(control); }, scope);
    app.events.on('player.jump', () => { this.used('jump'); }, scope);
    app.events.on('player.dodge', () => { this.used('dodge'); }, scope);
  }

  /** the shard's triggers, highest priority first (replaces any earlier feed) */
  feed(triggers: HintTrigger[]): void { this.triggers = triggers; }

  /** true once the control's hint is done (used, or retired) */
  done(c: HintControl): boolean { return this.seen.has(c); }

  /** metres walked since the first frame in the world */
  get distance(): number { return this.walked; }

  /** the player used the control: its hint goes and never comes back */
  used(c: HintControl): void {
    if (this.seen.has(c)) return;
    this.seen.add(c);
    try { savedStorage.setItem(STORE, JSON.stringify([...this.seen])); } catch { /* storage blocked: known for this session only */ }
    if (this.current?.control === c) this.show(null);
  }

  update(dt: number): void {
    if (this.opts.paused()) { this.show(null); return; }
    this.lookT -= dt;
    if (this.lookT <= 0) { this.lookT = MEASURE_EVERY; this.anchors.clear(); }
    this.track();
    if (lockOn.state === 'locked') this.used('lock'); // a tap-to-lock on the enemy itself counts too
    let pick: HintTrigger | null = null;
    for (const t of this.triggers) {
      if (this.seen.has(t.control) || !t.when() || this.anchor(t.control) === undefined) continue;
      pick = t; break;
    }
    const cur = this.current;
    if (cur !== null && pick !== cur && this.shownT < MIN_SHOWN && !this.seen.has(cur.control) && cur.when()) pick = cur;
    if (pick !== cur) this.show(pick);
    if (this.current === null) return;
    const c = this.current.control;
    this.shownT += dt;
    const all = (this.shownAll.get(c) ?? 0) + dt;
    this.shownAll.set(c, all);
    if (all > MAX_SHOWN) { this.used(c); return; }
    this.measureT -= dt;
    if (this.measureT <= 0) { this.measureT = MEASURE_EVERY; this.place(); }
  }

  /** the walked distance; MOVE counts as used after MOVED metres */
  private track(): void {
    const p = this.player.position;
    if (this.origin === null) { this.origin = { x: p.x, z: p.z }; this.last = { x: p.x, z: p.z }; return; }
    const step = Math.hypot(p.x - this.last.x, p.z - this.last.z);
    this.last.x = p.x; this.last.z = p.z;
    if (step < 2) this.walked += step; // a respawn / teleport is not a walk
    if (this.walked >= MOVED) this.used('move');
  }

  /** the touch control a hint sits on, when it is on screen (undefined: not drawn now, so no hint); null = the desktop line */
  private anchor(c: HintControl): HTMLElement | null | undefined {
    if (!this.opts.touch) return null;
    if (this.anchors.has(c)) return this.anchors.get(c);
    const el = document.querySelector<HTMLElement>(`.ws-touch ${ANCHOR[c]}`), found = el !== null && shown(el) ? el : undefined;
    this.anchors.set(c, found);
    return found;
  }

  private show(t: HintTrigger | null): void {
    this.current = t; this.shownT = 0; this.measureT = 0;
    if (t === null) { this.ring.classList.remove('show'); this.tag.classList.remove('show'); return; }
    const text = (this.opts.touch ? t.touch ?? HINT_TOUCH[t.control] : t.desk ?? deskHint(t.control)).toUpperCase();
    const sp = text.indexOf(' ');
    const lit = document.createElement('b');
    lit.textContent = sp > 0 ? text.slice(0, sp) : text;
    this.words.replaceChildren(lit, sp > 0 ? text.slice(sp) : '');
    this.tag.classList.add('show');
    this.ring.classList.toggle('show', this.opts.touch);
    this.place();
  }

  /** ring around the control, tag above it where it covers no other control; the desktop line needs no placing */
  private place(): void {
    const t = this.current;
    if (t === null || !this.opts.touch) return;
    const el = this.anchor(t.control);
    if (el === undefined || el === null) { this.show(null); return; }
    const hud = this.tag.parentElement?.getBoundingClientRect() ?? new DOMRect(0, 0, innerWidth, innerHeight);
    const r = el.getBoundingClientRect();
    const x0 = r.left - hud.left, y0 = r.top - hud.top, w = r.width, h = r.height;
    const round = Math.abs(w - h) < 4;
    const rs = this.ring.style;
    rs.left = `${x0 - RING_PAD}px`; rs.top = `${y0 - RING_PAD}px`; rs.width = `${w + RING_PAD * 2}px`; rs.height = `${h + RING_PAD * 2}px`;
    this.ring.classList.toggle('round', round);

    const tw = this.tag.offsetWidth, th = this.tag.offsetHeight, W = hud.width;
    const cx = x0 + w / 2;
    const obstacles: Box[] = [];
    for (const o of document.querySelectorAll<HTMLElement>(`.ws-touch :is(${OBSTACLES}), ${PAGE_OBSTACLES}`)) {
      if (o === el || o.contains(el) || !shown(o)) continue;
      const b = o.getBoundingClientRect();
      obstacles.push({ l: b.left - hud.left - 4, t: b.top - hud.top - 4, r: b.right - hud.left + 4, b: b.bottom - hud.top + 4 });
    }
    const clampX = (l: number): number => Math.max(MARGIN, Math.min(W - MARGIN - tw, l));
    // candidates: centred over the control, then slid left / right clear of whatever it covered, then a row higher
    let best: Box | null = null;
    for (let row = 0; row < 3 && best === null; row++) {
      const top = y0 - (row === 0 ? RING_PAD : 0) - TAG_GAP - th - row * (th + 10);
      const tries = [clampX(cx - tw / 2)];
      for (const o of obstacles) { tries.push(clampX(o.l - tw - 2), clampX(o.r + 2)); }
      tries.sort((a, b) => Math.abs(a + tw / 2 - cx) - Math.abs(b + tw / 2 - cx));
      for (const l of tries) {
        const box = { l, t: top, r: l + tw, b: top + th };
        if (!obstacles.some((o) => overlaps(o, box))) { best = box; break; }
      }
    }
    best ??= { l: clampX(cx - tw / 2), t: y0 - TAG_GAP - th, r: 0, b: 0 };
    const ts = this.tag.style;
    ts.left = `${best.l}px`; ts.top = `${best.t}px`;
    // the notch points at the control: under the tag when the control is below it, else on the side toward it
    const side = cx < best.l + 10 ? 'left' : cx > best.l + tw - 10 ? 'right' : 'down';
    if (this.tag.dataset['notch'] !== side) this.tag.dataset['notch'] = side; // FC14: only on change
    ts.setProperty('--nx', `${Math.max(10, Math.min(tw - 10, cx - best.l))}px`);
  }
}
