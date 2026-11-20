import type { UiHandle } from '../../ui/layers';
import { DialogueClock } from '../../../../shared/engine/quest/dialogueClock';
import { uiScope, mountUi } from '../../ui/ownership';
import { engineString } from '../../../../shared/engine/strings';
import { talkPages } from './talkPages';
/**
 * The adventure's own HUD pieces (kept out of HUD.ts, which the HUD agent owns) — DOM in `#hud`, styled by
 * src/client/engine/ui/styles/quest.css (prefix ws-quest-):
 *
 *   ObjectiveLine — the quest chip (E51, mockup G art/quest/round-1-compact/G.jpg): ONE slim glass line under the
 *                   minimap, right-aligned to it — ◆ "GLYPH SHARDS 1/3" | "SEA CAVE 230 M" ▲ (the arrow turns with the
 *                   nearest marker's bearing). Pulses cyan when the goal or its count changes. The chapter title, the full
 *                   objective and its sub-steps are on the menu's MAP tab (FullMap.setQuest) and in the step toasts.
 *   DialogueBox   — the NPC dialogue panel: name, a typed-out line, "[E] NEXT"; E / the touch USE / a tap advances,
 *                   a line still typing completes first.
 *   RewardCaption — the big centred caption over the golden-hour reward view.
 */
import '../../ui/styles/quest.css';
import type { Scope } from '../../../../shared/engine/app/scope';
import { app } from '../../app/runtime';
import { hudSlots } from '../../ui/hudSlots';
import { exploreChannel } from '../../app/view/exploreChannel';
import { listenPage } from '../../input/dom';

const hudRoot = (): HTMLElement => document.getElementById('hud') ?? document.body;
const touchHud = (): boolean => document.getElementById('hud')?.classList.contains('touch') === true;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, parent?: HTMLElement): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag); e.className = cls; parent?.append(e); return e;
};

/** QA-FEEDBACK 11-19 row 28: how long a quest's completion holds the tracker before the next objective takes it */
const COMPLETE_MS = 2500;

/** the quest chip: one slim glass line under the minimap with the goal, its count and the nearest marker's bearing.
 *  QA-FEEDBACK 11-19 row 28 (Jake: "We shouldn't even be having overlapping badges like that"): every quest on a page has a
 *  chip, all in this one spot, so they share it: one badge at a time. A fresh completion holds it for COMPLETE_MS, then the
 *  most recently changed objective; a finished quest's badge stays only while no other quest has a goal. A chip that gives
 *  way leaves at once (`ws-quest-yield`), so the old badge is gone before the new one fades in. */
export class ObjectiveLine {
  private static readonly live = new Set<ObjectiveLine>();
  private static order = 0;
  /** when the newest completion's hold ends (0: none pending) */
  private static holdEnds = 0;
  /** the newest frame time any chip was updated with (ms): the chips' own clock */
  private static clockMs = 0;
  private static share(): void {
    const now = ObjectiveLine.clockMs;
    let fresh: ObjectiveLine | null = null, goal: ObjectiveLine | null = null, done: ObjectiveLine | null = null;
    for (const c of ObjectiveLine.live) {
      if (!c.has) continue;
      if (!c.finished) { if (goal === null || c.seq > goal.seq) goal = c; }
      else if (now - c.changedAt < COMPLETE_MS) { if (fresh === null || c.seq > fresh.seq) fresh = c; }
      else if (done === null || c.seq > done.seq) done = c;
    }
    const drawn = fresh ?? goal ?? done;
    for (const c of ObjectiveLine.live) { c.root.classList.toggle('show', c === drawn); c.root.classList.toggle('ws-quest-yield', c !== drawn); }
  }
  private seq = 0; private changedAt = -Infinity; private has = false; private finished = false;
  readonly scope: Scope = uiScope('objective');
  readonly root: HTMLDivElement = el('div', 'ws-quest-obj');
  private goal = el('span', 'ws-quest-obj-goal', this.root);
  private label = el('span', 'ws-quest-obj-label', this.goal);
  private count = el('span', 'ws-quest-obj-count', this.goal);
  private sep = el('span', 'ws-quest-obj-sep', this.root);
  private nav = el('span', 'ws-quest-obj-nav', this.root);
  private navName = el('span', 'ws-quest-obj-name', this.nav);
  private navDist = el('span', 'ws-quest-obj-dist', this.nav);
  private arrow = el('span', 'ws-quest-obj-arrow', this.nav);
  private last = '';
  private lastNav = '';
  private placeT = -Infinity;
  private placing: ResizeObserver | null = null;

  constructor() {
    this.root.prepend(el('i', 'ws-quest-obj-dia'));
    this.arrow.textContent = engineString('s_671fd067cc0e');
    this.sep.style.display = this.nav.style.display = 'none';
    mountUi(this.root, this.scope, hudRoot());
    ObjectiveLine.live.add(this);
    this.scope.onDispose(() => { ObjectiveLine.live.delete(this); ObjectiveLine.share(); });
  }

  /** the chip's goal: a short label ("Glyph shards") and its counter ("1/3", or '') — pulses cyan when either changes */
  set(label: string, count: string): void {
    const key = `${label}|${count}`;
    if (key === this.last) return;
    if (this.last !== '') { this.root.classList.remove('pulse'); void this.root.offsetWidth; this.root.classList.add('pulse'); }
    this.last = key;
    this.label.textContent = label;
    this.count.textContent = count;
    this.count.style.display = count ? '' : 'none';
    this.has = label !== ''; this.finished = label === engineString('s_f316ae64883e');
    this.seq = ++ObjectiveLine.order; this.changedAt = ObjectiveLine.clockMs;
    if (this.finished) ObjectiveLine.holdEnds = this.changedAt + COMPLETE_MS;
    ObjectiveLine.share();
  }

  /** hide the chip while a caption has the screen (`ws-quest-hide`); it keeps its place and its goal */
  hide(on: boolean): void { this.root.classList.toggle('ws-quest-hide', on); }

  /** the nearest marker: short name, metres, and its bearing relative to the view (radians, 0 = straight ahead, + = right) */
  setNav(name: string | null, metres: number, rel: number): void {
    if (name === null) {
      if (this.lastNav !== '') { this.lastNav = ''; this.sep.style.display = this.nav.style.display = 'none'; }
      return;
    }
    if (this.lastNav === '') this.sep.style.display = this.nav.style.display = '';
    if (name !== this.lastNav) { this.lastNav = name; this.navName.textContent = name; }
    const d = `${Math.round(metres)} m`;
    if (this.navDist.textContent !== d) this.navDist.textContent = d;
    const turn = `rotate(${Math.round((rel * 180) / Math.PI)}deg)`; // FC14: whole degrees, written only on change
    if (this.arrow.style.transform !== turn) this.arrow.style.transform = turn;
  }

  /** keep it under the minimap, right-aligned to its right edge (the minimap's size and top differ per layout and the
   *  home-screen mode); the toasts stack under it (A1, HUD.toast). Called every frame: it looks for the minimap ~once a
   *  second, then places the chip from the minimap's and the HUD's size reports, read right after a layout (a read here,
   *  on the frame the HUD was built, forced a whole-page layout). */
  update(t: number): void {
    const next = t * 1000;
    if (next < ObjectiveLine.clockMs) { // a clock that restarted (a new level's frame time): keep every hold's length
      const back = ObjectiveLine.clockMs - next;
      if (ObjectiveLine.holdEnds !== 0) ObjectiveLine.holdEnds -= back;
      for (const c of ObjectiveLine.live) c.changedAt -= back;
    }
    ObjectiveLine.clockMs = next;
    if (ObjectiveLine.holdEnds !== 0 && ObjectiveLine.clockMs >= ObjectiveLine.holdEnds) { ObjectiveLine.holdEnds = 0; ObjectiveLine.share(); }
    if (this.placing !== null || t - this.placeT < 1) return;
    this.placeT = t;
    const mini = document.querySelector('.ws-minimap'), parent = this.root.parentElement;
    if (!(mini instanceof HTMLElement)) return;
    const placing = this.placing = new ResizeObserver(() => { this.place(mini); });
    placing.observe(mini); if (parent !== null) placing.observe(parent);
    this.scope.onDispose(() => { placing.disconnect(); });
  }

  private place(mini: HTMLElement): void {
    const r = mini.getBoundingClientRect();
    if (r.bottom <= 0) return;
    const host = this.root.offsetParent?.getBoundingClientRect() ?? { top: 0, right: window.innerWidth };
    this.root.style.top = `${Math.round(r.bottom - host.top + 12)}px`;   // clear of the rim's ticks (they poke 6–8 px out)
    this.root.style.right = `${Math.round(host.right - r.right)}px`;
  }
}

/** the NPC dialogue panel: the speaker's name and the typed-out lines, advanced with E or a tap */
/** One answer a dialogue node offers: its label, and what taking it does. */
export interface DialogueChoice { readonly label: string; readonly pick: () => void }

/** SHARD-SOURCE SS-MS1a3: the race clock, a slim glass chip at the top centre: the running time, then the finish time and the best. */
export class RaceClockChip {
  readonly scope: Scope;
  readonly root: HTMLDivElement = el('div', 'ws-quest-race');
  constructor(owner: Scope) { this.scope = uiScope('race-clock', owner); mountUi(this.root, this.scope, hudRoot()); }
  show(text: string | null): void {
    if (text !== null) this.root.textContent = text;
    this.root.classList.toggle('show', text !== null);
  }
}

/** An inline glyph for a seat's disc, in the touch discs' 64-unit box. */
const glyph = (body: string): string => `<svg viewBox="0 0 64 64" fill="currentColor" stroke="none">${body}</svg>`;
const DRIVE_GLYPHS = {
  brake: glyph('<rect x="14" y="20" width="36" height="24" rx="6"/><rect x="20" y="46" width="24" height="6" rx="3"/>'),
  boost: glyph('<path d="M12 16 L30 32 L12 48 Z"/><path d="M32 16 L50 32 L32 48 Z"/>'),
  horn: glyph('<path d="M10 26 H22 L46 12 V52 L22 38 H10 Z"/><rect x="50" y="28" width="6" height="8" rx="2"/>'),
  leave: glyph('<rect x="10" y="10" width="26" height="44" rx="3" fill="none" stroke="currentColor" stroke-width="5"/><path d="M34 32 H56 M46 22 L56 32 L46 42" fill="none" stroke="currentColor" stroke-width="5"/>'),
} as const;

/**
 * MIRROR-SALT-ZONE MSZ12: a vehicle seat's touch controls. The `drive` input context blocks the walk's verbs, so their discs
 * hide (TouchControls shows a disc only while its action is live), and these take their places. BRAKE stands where ATTACK
 * does (held, it brakes; held on, the handbrake), BOOST where JUMP does, HORN where DODGE does, and LEAVE on the left edge
 * where the HOVER tab does, while the USE band (which would read the same *Get out*) hides. Each holds its `drive.*` action.
 */
export class DriveDiscs {
  private readonly discs: HTMLButtonElement[];
  private layer: HTMLElement | null = null;
  constructor(scope: Scope) {
    const hold = (action: 'drive.brake' | 'drive.boost' | 'drive.horn'): { press: () => void; release: () => void } =>
      ({ press: () => { app.input.setHeld(action, true); }, release: () => { app.input.setHeld(action, false); } });
    this.discs = [
      hudSlots.disc({ cls: 'ws-touch-drive-brake', icon: DRIVE_GLYPHS.brake, label: engineString('s_drive_brake'), spot: 'r2', ...hold('drive.brake') }, scope),
      hudSlots.disc({ cls: 'ws-touch-drive-boost', icon: DRIVE_GLYPHS.boost, label: engineString('s_drive_boost'), spot: 'r0', ...hold('drive.boost') }, scope),
      hudSlots.disc({ cls: 'ws-touch-drive-horn', icon: DRIVE_GLYPHS.horn, label: engineString('s_drive_horn'), spot: 'r1', ...hold('drive.horn') }, scope),
      hudSlots.disc({ cls: 'ws-touch-drive-leave', icon: DRIVE_GLYPHS.leave, label: engineString('s_drive_leave'), spot: 'edge-l', press: () => { app.input.press('use'); } }, scope),
    ];
    scope.onDispose(hudSlots.onLayer(layer => { this.layer = layer; }));
  }
  /** The discs shown (seated) or hidden; hiding lets go of whatever they held. */
  show(on: boolean): void {
    for (const disc of this.discs) { hudSlots.show(disc, on); if (!on) disc.classList.remove('down'); }
    this.layer?.classList.toggle('ws-touch-drive-seated', on);
    if (!on) for (const action of ['drive.brake', 'drive.boost', 'drive.horn'] as const) app.input.setHeld(action, false);
  }
  /** Each disc's class and whether it shows, for a probe. */
  shown(): readonly { readonly cls: string; readonly show: boolean }[] {
    return this.discs.map(disc => ({ cls: [...disc.classList].find(name => name.startsWith('ws-touch-drive-')) ?? '', show: disc.classList.contains('show') }));
  }
}

/** SHARD-SOURCE SS-MS2a3: a steer ride's chip at the bottom centre: its speed bar, BOOST lit while it boosts, and how to boost
 *  (Shift; on a phone, the stick pushed all the way). Leaving is the vehicle's own prompt. */
/** MSZ18: ms the steer chip says vehicles stay in the zone. */
const STAY_MS = 2500;
export class SteerChip {
  readonly scope: Scope;
  readonly root: HTMLDivElement = el('div', 'ws-quest-steer');
  private readonly bar = el('div', 'ws-quest-steer-bar', this.root);
  private readonly fill = el('div', 'ws-quest-steer-fill', this.bar);
  private readonly boost = el('div', 'ws-quest-steer-boost', this.root);
  /** MSZ12: a vehicle seat's gear (R N D, the one in use lit) and its controls' hints, shown while seated */
  private readonly gears = el('div', 'ws-quest-steer-gears', this.root);
  private readonly gear = new Map((['R', 'N', 'D'] as const).map(letter => { const g = el('b', '', this.gears); g.textContent = letter; return [letter, g] as const; }));
  private readonly seatHint = el('div', 'ws-quest-steer-boost ws-quest-steer-seat', this.root);
  /** MSZ18: *Vehicles stay in this zone*, for a moment after the cell's edge turns a vehicle back */
  private readonly stayNote = el('div', 'ws-quest-steer-stay', this.root);
  private stayTimer: ReturnType<Scope['timeout']> | undefined;
  private discs: DriveDiscs | null = null;
  constructor(owner: Scope) {
    this.scope = uiScope('steer-ride', owner); mountUi(this.root, this.scope, hudRoot());
    el('span', 'ws-quest-steer-key', this.boost).textContent = engineString('s_steer_boost_key');
    el('span', 'ws-quest-steer-touch', this.boost).textContent = engineString('s_steer_boost_touch');
    el('span', 'ws-quest-steer-key', this.seatHint).textContent = engineString('s_drive_keys');
    el('span', 'ws-quest-steer-touch', this.seatHint).textContent = engineString('s_drive_touch');
  }
  show(ride: { readonly speed: number; readonly boosting: boolean; readonly gear?: 'R' | 'N' | 'D' } | null): void {
    this.root.classList.toggle('show', ride !== null);
    if (ride === null) return;
    this.fill.style.width = `${String(Math.round(ride.speed * 100))}%`;
    this.root.classList.toggle('boosting', ride.boosting);
    for (const [letter, g] of this.gear) g.classList.toggle('on', ride.gear === letter);
  }
  /** MIRROR-SALT-ZONE MSZ12: a vehicle seat is taken or left: the gauge shows its gear and the seat's hints, and on a phone the
   *  seat's discs (BRAKE, BOOST, HORN, LEAVE) take the walk's places (`DriveDiscs`). */
  seated(on: boolean): void {
    this.root.classList.toggle('seated', on);
    if (on) this.discs ??= new DriveDiscs(this.scope);
    this.discs?.show(on);
  }
  /** MIRROR-SALT-ZONE MSZ18: the cell's edge turned the vehicle back: say vehicles stay in the zone for `STAY_MS`. */
  stays(): void {
    this.stayNote.textContent = engineString('s_vehicle_stays'); this.root.classList.add('staying');
    this.scope.cancelTimer(this.stayTimer);
    this.stayTimer = this.scope.timeout(STAY_MS, () => { this.stayTimer = undefined; this.root.classList.remove('staying'); });
  }
  /** MIRROR-SALT-ZONE MSZ11: a tap or click on the chip runs `run` (a vehicle seat swaps its view by it). */
  tap(run: () => void): void {
    this.root.classList.add('tappable');
    this.scope.listen(this.root, 'pointerdown', (event: PointerEvent) => { event.preventDefault(); event.stopPropagation(); run(); });
  }
}

export class DialogueBox {
  readonly root: HTMLDivElement = el('div', 'ws-quest-talk');
  private name = el('div', 'ws-quest-talk-name', this.root);
  private text = el('div', 'ws-quest-talk-text', this.root);
  private foot = el('div', 'ws-quest-talk-foot', this.root);
  private page = el('span', '', this.foot);
  /** J473 row 4: the footer's two buttons (LEAVE shows on a touch HUD only; E / Escape do the same on a keyboard) */
  private acts = el('span', 'ws-quest-talk-acts', this.foot);
  private leave = el('b', 'ws-quest-talk-leave', this.acts);
  private next = el('b', 'ws-quest-talk-next', this.acts);
  /** TE-ENG3: a node's choices, under its last line: E takes the first, a digit or a tap takes its own. */
  private readonly options = el('div', 'ws-quest-talk-choices', this.root);
  private choices: readonly DialogueChoice[] = [];
  private readonly clock = new DialogueClock();
  private layer: UiHandle | null = null;
  private get open_(): boolean { return this.layer?.active ?? false; }
  private finish_: (() => void) | null = null;
  private openT = 0;
  private readonly scope: Scope;
  /** chars per second of the type-out */
  cps = 60;

  /** E or a click on the box (desktop) and NEXT (touch) advance it; LEAVE closes it. J473 row 4 (Jake, 2026-11-19 grill wave
   *  3: "NEXT and LEAVE buttons", not tap-the-box): on a touch HUD a tap elsewhere on the box does nothing. Firing closes it
   *  (FIRE, AIM, DODGE and JUMP stay live in a talk: the `dialog` input context blocks none of them). */
  constructor(scope: Scope = uiScope('dialogue')) {
    this.scope = scope;
    mountUi(this.root, this.scope, hudRoot());
    this.leave.textContent = engineString('s_talk_leave');
    scope.listen(this.root, 'pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      const at = e.target instanceof Element ? e.target : null;
      if ((at?.closest('.ws-quest-talk-leave') ?? null) !== null) { this.close(false); return; }
      if ((at?.closest('.ws-quest-talk-next') ?? null) !== null || !touchHud()) this.advance();
    });
    app.input.bind('attack', () => { this.close(false); }, scope, () => this.open_);
    for (const action of ['use', 'confirm'] as const) app.input.bind(action, () => { this.advance(); }, scope,
      () => this.open_ && (this.layer?.top ?? false) && app.clock.real * 1000 - this.openT >= 150);
    scope.listen(this.options, 'pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      const row = e.target instanceof HTMLElement ? e.target.closest<HTMLElement>('[data-choice]') : null;
      if (row !== null && this.choosing) this.choose(Number(row.dataset['choice']));
    });
    listenPage(scope, 'keydown', (e) => {
      const n = Number.parseInt(e.key, 10);
      if (!this.choosing || !(this.layer?.top ?? false) || !Number.isInteger(n) || n < 1 || n > this.choices.length) return;
      e.preventDefault(); this.choose(n - 1);
    });
    scope.onDispose(() => { this.close(false); this.root.remove(); });
  }

  /** On the last line, typed out, with choices to make. */
  private get choosing(): boolean { return this.open_ && this.choices.length > 0 && this.clock.index + 1 >= this.clock.count && this.clock.text.length >= this.clock.line.length; }
  /** Take a choice: the box closes without its done, and the choice says what comes next. */
  private choose(index: number): void {
    const choice = this.choices[index]; if (choice === undefined) return;
    this.finish_ = null; this.close(false); choice.pick();
  }

  dispose(): void { this.scope.dispose(); }

  get isOpen(): boolean { return this.open_; }
  /** Lend the panel's actual clock to a reading opened by its NPC owner. */
  get readingClock():DialogueClock {return this.clock;}

  open(name: string, lines: string[], onDone: () => void, choices: readonly DialogueChoice[] = []): void {
    if (lines.length === 0) { onDone(); return; }
    this.name.textContent = name;
    this.setChoices(choices);
    this.clock.open(this.paged(lines)); this.finish_ = onDone; this.layer?.dispose();
    this.layer = app.ui.push('modal', { root: this.root, presentation: 'world', order: -42, yieldsToMenu: true, back: () => { this.close(false); } }, this.scope); this.openT = app.clock.real * 1000;
    this.root.classList.add('show');
    this.render();
  }

  /** J473 row 4: on a touch HUD a line that wraps past 3 lines in the box splits into pages (measured in the box's own font). */
  private paged(lines: string[]): string[] {
    if (!touchHud() || typeof getComputedStyle !== 'function') return lines;
    const width = this.text.clientWidth, pen = document.createElement('canvas').getContext('2d');
    if (pen === null || width <= 0) return lines;
    pen.font = getComputedStyle(this.text).font;
    // a hair of slack: the page's own wrapping (kerning, subpixel widths) can break a line a little earlier than the pen
    return lines.flatMap((line) => talkPages(line, (text) => pen.measureText(text).width, width * 0.97));
  }

  /** Replace the open node's choices, its lines and place kept: a flag they read changed. */
  offer(choices: readonly DialogueChoice[]): void { if (this.open_) { this.setChoices(choices); this.render(); } }
  private setChoices(choices: readonly DialogueChoice[]): void {
    this.choices = choices; this.options.replaceChildren();
    for (const [index, choice] of choices.entries()) {
      const row = el('div', 'ws-quest-talk-choice', this.options);
      row.textContent = choice.label; row.dataset['choice'] = String(index);
    }
  }

  /** E / tap: finish the typing, else the next line, else close */
  advance(): void {
    if (!this.open_) return;
    if (this.choosing) { this.choose(0); return; }
    if (this.clock.advance() === 'finished') { this.close(true); return; }
    this.render();
  }

  close(finished = false): void {
    if (!this.open_) return;
    this.layer?.dispose(); this.layer = null; this.clock.close();
    this.root.classList.remove('show', 'choosing');
    const done = this.finish_; this.finish_ = null;
    if (finished) done?.();
  }

  update(dt: number): void {
    if (!this.open_) return;
    if (this.clock.update(dt, this.cps)) this.render();
  }

  private render(): void {
    this.text.textContent = this.clock.text;
    this.root.classList.toggle('choosing', this.choosing);
    this.page.textContent = engineString('s_9404497cf77d', [this.clock.index + 1, this.clock.count]);
    const touch = touchHud();
    this.next.textContent = engineString('s_4ecdc2db1bc2', [touch ? '' : engineString('s_4f911ee89601'), this.clock.index + 1 < this.clock.count ? engineString('s_c93aad5dddf0') : engineString('s_f13a1ed0cf3c')]);
  }
}

/** the reward caption: a kicker, a title and a sub line, shown when a quest pays out */
export class RewardCaption {
  readonly scope: Scope = uiScope('reward');
  readonly root: HTMLDivElement = el('div', 'ws-quest-reward');
  constructor(kicker: string, title: string, sub: string) {
    el('div', 'ws-quest-reward-kicker', this.root).textContent = kicker;
    el('div', 'ws-quest-reward-title', this.root).textContent = title;
    el('div', 'ws-quest-reward-sub', this.root).textContent = sub;
    mountUi(this.root, this.scope, hudRoot());
  }
  show(on: boolean): void { this.root.classList.toggle('show', on && !exploreChannel()); }
}
