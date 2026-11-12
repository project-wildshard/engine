import { uiScope, mountUi } from './ownership';
import { engineString } from '../../../shared/engine/strings';
import type { WeaponUi } from '../../../shared/engine/combat/Equipment';
import { app } from '../app/runtime';
import { tap } from '../../../shared/engine/core/harnessTap';
import { activeLevel } from '../../../shared/engine/level/selection';
import { CABIN_SITES } from '../../../shared/engine/world/Heightfield';
import type { GameMenu } from './Menu';
import { openBootSettings } from './BootSettings';
import { isDev, onDev } from '../core/devMode';
import { mountDeveloperAlert, mountDeveloperBanner } from './developerBanner';
import { perfDockAlert, perfDockSection } from './perfDock';
import { ToastStack, type ToastTone } from './ToastStack';
import { ItemCardPop, type ItemCardSpec } from './ItemCard';
import { ROW, hudSlots } from './hudSlots';
import { listenReloadChip } from './reloadChip';

/**
 * HUD — DOM overlay in `#hud`, styled by `src/client/engine/ui/styles/game.css` / `menu.css` (the in-game menu is src/client/engine/ui/Menu.ts + gmenu.css) on top of `base.css` (Wildshard glass identity; one class prefix per screen, see scripts/check-css.mjs).
 *
 *   const hud = new HUD({ pointerLock?: boolean });   // pointerLock:false in ?nolock dev mode (no pause overlay)
 *   hud.showIntro(() => player.lock())                 // title screen: shard deck + ENTER WORLD / EXPLORE WORLD; any key → onEnter
 *   hud.onExplore = () => …  hud.startExplore()        // EXPLORE WORLD (src/client/engine/explore/Explore.ts); startExplore = a `?explore=` deep link
 *   hud.setState({ bolts?, loaded, reloading, reloadProgress?, health, pos: {x, z}, yaw, kills, prompt?, speed?, ads?,
 *                  maxBolts?, reserve?, ammoLabel?, weaponName?, segments? })
 *     — the ammo strip is generic: `bolts` is the held weapon's ammo (BOLTS 27 / 30 for the crossbow, ROUNDS 27 / 30 + 60
 *       with the "AR-15" tag for the rifle — src/engine/player/Weapons.ts)
 *     — `bolts: undefined` = the weapon has no ammo (the sword): the BOLTS panel, its meter and the touch-bar strip are hidden
 *   hud.showHitMarker(headshot, killed)  hud.killFeed('Boar · headshot')  hud.toast('Bolt recovered')
 *   hud.damageFlash()  hud.setBoundaryWarning(visible)  hud.menu = gameMenu  hud.setPaused(bool)  hud.onResume = () => …  // the menu's close
 *   hud.onExitToMain = () => …   // replace the document with the main title; no local cleanup
 *   hud.onExitToMenu = () => …   // local intro / practice-to-Explore: stop/mute the retained world here
 *   hud.setAimInfo(crossbow.aimInfo)   // "BOAR · 15 M" under the crosshair
 *   hud.setAnimals([{ x, z }, …])      // world positions of live animals: the compass pins a paw at the nearest one within 120 m
 *
 * Compass: a smoked-glass band (both desktop and touch) with a cyan house marker at the bearing of the nearest cabin
 * (`CABIN_SITES` — static, so the HUD reads them itself) and a "CABIN · 180 m" readout under it; the paw marker comes
 * from `state.nearest` (bearing in compass degrees, 0 = north) when the caller has one, else from `setAnimals`.
 *
 * Weather (Nalati, src/shards/nalati-grasslands/weather.ts): a `ws:weather` document event (`WeatherHUD` detail, `WEATHER_EVENT`) shows the
 * small STORM chip under the minimap ("STORM IN 0:45 · WIND 14 m/s", "STORM 2:10 · WIND 22 m/s") and the amber
 * "LIGHTNING — GET LOW" warning top-centre. Nothing is built until the first event, so other shards never see either.
 *
 * Call `setState` every frame (it diffs and only touches the DOM on change). Pause = the in-game menu on its
 * Settings tab: opened by the touch PAUSE button, Esc, or a released pointer lock after the chunk was entered
 * (`pointerLock` mode only); closing it fires `onResume`.
 */

export interface HUDState {
  weaponUi: WeaponUi;
  /** bolts carried; undefined = no ammo on this weapon (melee) → the ammo readouts are hidden */
  bolts?: number | undefined; loaded: boolean; reloading: boolean; reloadProgress?: number | undefined;
  health: number; pos: { x: number; z: number }; yaw: number; kills: number;
  /** the health bar's full mark (default 100; Driftwood's sturdy hearts raise it to 120 / 140, E314 stage 2) */
  maxHealth?: number | undefined;
  prompt?: string | undefined; speed?: number | undefined; ads?: boolean | undefined; maxBolts?: number | undefined;
  /** generic ammo strip (Weapons.ts): `reserve` rounds beyond the magazine (hidden when 0), `ammoLabel` "Bolts" / "Rounds",
   *  `weaponName` tag ("CROSSBOW" / "AR-15"), `segments` bars over the magazine on the touch strip (4 crossbow, 6 rifle) */
  reserve?: number | undefined; ammoLabel?: string | undefined; weaponName?: string | undefined; segments?: number | undefined;
  /** nearest animal for the compass paw: `bearing` in compass degrees (0 = north = +Z, 90 = east = −X) — see `bearingTo` */
  nearest?: { bearing: number; distance: number; kind: string } | undefined;
}
export interface HUDOptions { pointerLock?: boolean; weaponUi: WeaponUi; maxBolts: number; developerBanner?: string }
/** the `ws:weather` event's detail — sent on change only (src/shards/nalati-grasslands/weather.ts) */
export interface WeatherHUD {
  /** the chip under the minimap: `title` "STORM IN 0:45" / "STORM 2:10", `sub` "WIND 22 m/s"; null hides it */
  chip: { title: string; sub: string; tone: 'soon' | 'storm' | 'clearing' } | null;
  /** the amber LIGHTNING — GET LOW warning */
  getLow: boolean;
}
export const WEATHER_EVENT = 'ws:weather';
const SVG_STORM = '<svg viewBox="0 0 24 24"><path d="M7 15a5 5 0 0 1-.6-9.96A6.5 6.5 0 0 1 18.8 7.1 4 4 0 0 1 18 15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/><path d="M13.2 11.5 10 16.6h3l-2 5.2 5.2-6.6h-3l1.6-3.7z" fill="currentColor"/></svg>';
const SVG_WARN = '<svg viewBox="0 0 24 24"><path d="M12 3 1.8 20.5h20.4z" fill="currentColor"/><path d="M12 9.5v5.2M12 16.8v1.6" stroke="#1a1204" stroke-width="2.2" stroke-linecap="round"/></svg>';
export type IntroStats = Record<string, string | { value: string; tone?: 'ok' | 'warn' }>;

const HERO_FADE_MS = 350;

const CARDINALS: [number, string, boolean][] = [[0, 'N', true], [45, 'NE', false], [90, 'E', true], [135, 'SE', false], [180, 'S', true], [225, 'SW', false], [270, 'W', true], [315, 'NW', false]];
const BAND_DEGREES = 292; // the band spans this much heading (W · N · E all visible, like the K1 mockup); px/deg follows its width
const PAW_RANGE = 120;   // m — the compass only pins an animal this close
const MARKER_INSET = 22; // px — a marker behind the player parks at the band's edge instead of leaving it
/** E319 (Jake's clean-HUD pick B, rule 1): VITALS hide at full health — back to full, they stay this long, then fade out
 *  over VITALS_FADE_MS (game.css `.hp-fade`) and leave the column (`.hp-gone`, the rows under them move up). Any hit brings
 *  them back at once. */
const VITALS_HIDE_MS = 2000;
const VITALS_FADE_MS = 400;

/** compass bearing (deg, 0 = north) of the point (tx, tz) seen from (x, z). North is +Z (the south-gate spawn's forward,
 *  yaw π, is `player.forward = (−sin yaw, −cos yaw)` = +Z) and the heading is `180 − yaw°`, which puts east at −X. */
export function bearingTo(x: number, z: number, tx: number, tz: number): number {
  const deg = (Math.atan2(-(tx - x), tz - z) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}
const SVG_HEART = '<svg viewBox="0 0 24 24"><path d="M12 21s-7.6-4.7-9.6-9.3C1 8 3.2 4.5 6.7 4.5c2 0 3.6 1.1 5.3 3 1.7-1.9 3.3-3 5.3-3 3.5 0 5.7 3.5 4.3 7.2C19.6 16.3 12 21 12 21z"/></svg>';
const SVG_RELOAD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10a8 8 0 0 0-14-3L3 10m0-6v6h6M4 14a8 8 0 0 0 14 3l3-3m0 6v-6h-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const SVG_BOLT = '<svg viewBox="0 0 24 24"><path d="M21 3l-1.2 7.6-2.2-2.2-9.4 9.4 1.6 1.6-1.6 1.6-1.5-1.5-2.2 2.2-1.4-1.4 2.2-2.2-1.5-1.5 1.6-1.6 1.6 1.6 9.4-9.4-2.2-2.2z"/></svg>';
const SVG_HOUSE = '<svg viewBox="0 0 24 24"><path d="M12 3 2 12h3v8h5v-6h4v6h5v-8h3z"/></svg>';
const SVG_PAW = '<svg viewBox="0 0 24 24"><circle cx="4.6" cy="9.6" r="2.4"/><circle cx="9.2" cy="5.2" r="2.7"/><circle cx="14.8" cy="5.2" r="2.7"/><circle cx="19.4" cy="9.6" r="2.4"/><path d="M12 10c-3.6 0-7 3.3-7 6.6 0 2 1.4 3.4 3.3 3.4 1.4 0 2.3-.9 3.7-.9s2.3.9 3.7.9c1.9 0 3.3-1.4 3.3-3.4 0-3.3-3.4-6.6-7-6.6z"/></svg>';

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}
/** `root.querySelector(sel)` for markup this file wrote itself (build time only): a miss is a bug, so it throws */
function q(root: ParentNode, sel: string): HTMLElement {
  const e = root.querySelector<HTMLElement>(sel);
  if (!e) throw new Error(`HUD: no ${sel}`);
  return e;
}

/** The title screen's deck of level cards, as the HUD drives it (keys, refresh, enter / explore) */
export interface TitleDeckView {
  readonly root: HTMLElement;
  readonly cards: readonly { readonly slug: string }[];
  readonly index: number;
  readonly select: (i: number, smooth?: boolean) => void;
  readonly activate: () => void;
  readonly start: () => void;
  readonly dispose: () => void;
}
/** Builds the deck: `here` plays this level, opens its Explore, or the boot settings; other cards are the game's to open */
export type TitleDeckFactory = (here: { enter: () => void; explore: () => void; settings: () => void }) => TitleDeckView;

export class HUD {
  readonly scope: ReturnType<typeof uiScope> = uiScope('HUD');
  root: HTMLElement;
  onResume?: () => void;
  onExitToMenu?: () => void;
  /** Leave the page session for its clean main title; practice-to-Explore keeps its existing owner. */
  onExitToMain?: () => void;
  private opts: HUDOptions;
  private _entered = false;
  get entered(): boolean { return this._entered; }
  set entered(value: boolean) {
    this._entered = value;
    if (value) this.warmGlass();
    if (app.input.hasContext('title')) { if (value) app.input.pop('title'); else app.input.push('title', app.levelScope ?? app.engineScope); }
    if (app.state !== 'loading') app.setState(value ? 'play' : 'title');
  }
  private onEnter?: () => void;
  /** EXPLORE WORLD on the title (main.ts opens src/client/engine/explore/Explore.ts) */
  onExplore?: () => void;
  /** Shared HUD + Weapon Explorer practice room, reached as a title spawn mode. */
  onArena?: () => void;

  private compassStrip!: HTMLElement; private band!: HTMLElement;
  private markHouse!: HTMLElement; private markPaw!: HTMLElement; private range!: HTMLElement;
  private animals: { x: number; z: number }[] = [];
  /** touch layout E (E42): the vitals + bolts strips rendered into TouchControls' top-left status column (`.ws-touch-status`, under PAUSE) */
  private bar?: { vitals: HTMLElement; hval: HTMLElement; hbar: HTMLElement; bolts: HTMLButtonElement; glyph: HTMLElement; bcount: HTMLElement; segs: HTMLElement[]; segBox: HTMLElement; label: HTMLElement; weapon: HTMLElement; max: HTMLElement; reserve: HTMLElement };
  private lastMark = { house: Number.NaN, paw: Number.NaN, range: '' };
  /** The displayed distance, so an unchanged frame does not rebuild its text. */
  private cabinMetres: number | null | undefined;
  private ppd = 1.2; // compass px per degree — measured from the band (`--ppd`), see build()
  /** the band's width, measured when it resizes (build()'s fit): placeMark ran every frame and read clientWidth after the
   *  frame's HUD writes — a forced layout per frame (E142 aggro-perf) */
  private bandW = -1;
  private feed!: HTMLElement; private toasts!: ToastStack; private toastBox!: HTMLElement;
  private healthVal!: HTMLElement; private healthBar!: HTMLElement; private healthPanel!: HTMLElement; private healthMax!: HTMLElement;
  /** E319: when health last reached full (performance.now; -Infinity = full since the start, null = hurt) and the VITALS
   *  visibility as last painted — they start hidden, the player spawns at full health */
  private hpFullAt: number | null = Number.NEGATIVE_INFINITY; private hpShown: 'show' | 'fade' | 'gone' = 'gone';
  private ammoCount!: HTMLElement; private ammoNum!: HTMLElement; private ammoStatus!: HTMLElement; private ammoStatusText!: HTMLElement; private reloadBar!: HTMLElement; private pips: HTMLElement[] = [];
  private cross!: HTMLElement; private killX!: HTMLElement; private hitRing!: HTMLElement; private aim!: HTMLElement; private aimText = '';
  private prompt!: HTMLElement; private boundary!: HTMLElement; private flash!: HTMLElement;
  private intro?: HTMLElement | undefined;
  /** the in-game menu (src/client/engine/ui/Menu.ts) — pause opens it on Settings; its close is our `onResume` */
  private _menu?: GameMenu;
  private deck?: TitleDeckView | undefined;
  /** builds the title screen's deck (the game installs it: src/client/game/titleDeck.ts, E318; E405: the engine imports no game) */
  titleDeck: TitleDeckFactory | null = null;
  private last: Partial<HUDState> & { statusKey?: string | undefined; headingDeg?: number | undefined; noAmmo?: boolean | undefined } = {};
  private magazineChip = false; private canReloadChip = false;
  private ammoPanel!: HTMLElement;
  private ammoLabel!: HTMLElement; private ammoMax!: HTMLElement; private ammoReserve!: HTMLElement; private ammoWeapon!: HTMLElement; private pipBox!: HTMLElement;
  private hitTimer = 0; private spread = 7;

  /** the weather chip + GET LOW warning (built on the first `ws:weather` event) */
  private weather?: { chip: HTMLElement; title: HTMLElement; sub: HTMLElement; low: HTMLElement; last: string };

  /** the review composer (src/client/engine/ui/Feedback.ts) is up: losing the pointer lock does not open the pause menu */
  holdPause = false;
  /** when the menu last closed (performance.now) — see the pointerlockchange listener */


  /** The exact text currently displayed by the interaction prompt. */
  get promptText(): string { return this.prompt.classList.contains('show') ? this.prompt.textContent : ''; }

  constructor(opts: HUDOptions) {
    this.opts = { pointerLock: true, ...opts };
    const hud = document.getElementById('hud');
    this.root = hud ?? el('div');
    if (!hud) mountUi(this.root, this.scope, document.body);
    this.root.id = 'hud';
    this.build();
    this.mountBar();
    this.scope.onDispose(onDev(() => {
      if (!this.intro || !this.onEnter) return;
      const selected = this.deck?.cards[this.deck.index]?.slug;
      this.intro.remove(); this.deck?.dispose();
      this.showIntro(this.onEnter);
      const index = this.deck?.cards.map((card): string => card.slug).indexOf(selected ?? '') ?? -1;
      if (index !== -1) this.deck?.select(index, false);
    }));
    this.scope.listen(document, 'pointerlockchange', () => {
      if (!this.opts.pointerLock || !this.entered || this.holdPause || (app.ui.blocking && app.ui.top !== 'gameMenu')) return;
      const locked = Boolean(document.pointerLockElement); // undefined where pointer lock is absent (iOS)
      // the lock came back: close the menu. It went away: pause — unless the menu is already up. M / I / the minimap open it
      // on their tab and release the lock themselves (Menu.onOpen); that release used to flip it to Settings (E130)
      // A lock lost within a moment of the menu closing is the Esc that closed it (the browser's own Esc handling
      // releases the lock the close had just re-taken): stay closed, a click on the canvas takes the lock back
      if (locked) this.setPaused(false); else if (!this.paused && app.clock.real * 1000 - app.ui.closedAt > 400) this.setPaused(true);
    });
    // KP4 (Jake 2026-11-09: "Same for command T, command N"): ⌘T hides the tab (ws:background pauses), ⌘N or a click in
    // another window only takes the focus. Without a pointer lock to lose, that left the world running; the held keys were
    // already let go on blur (InputService), so the player comes back to the pause menu, standing still
    // (focus moving into one of the page's own frames blurs the window too: that is not leaving, so it waits a turn and looks)
    this.scope.listen(window, 'blur', () => {
      this.scope.timeout(0, () => {
        if (document.activeElement instanceof HTMLIFrameElement && document.hasFocus()) return;
        if (!this.entered || this.paused || this.holdPause || (app.ui.blocking && app.ui.top !== 'gameMenu')) return;
        this.setPaused(true);
      });
    });
    const titleScope = (app.levelScope ?? app.engineScope).child('input.title');
    const title = (): boolean => this.intro !== undefined && !this.entered && !app.ui.blocking;
    app.input.bind('nav.left', () => { this.deck?.select(this.deck.index - 1); }, titleScope, title);
    app.input.bind('nav.right', () => { this.deck?.select(this.deck.index + 1); }, titleScope, title);
    app.input.bind('confirm', () => { if (this.deck) this.deck.activate(); else this.enter(); }, titleScope, title);
  }

  private build(): void {
    const r = this.root;
    mountDeveloperBanner(this.scope, this.opts.developerBanner);
    // (the desktop chunk panel — chunk:// id, grid, pos, "local build" — is gone: E140, the user's verdict on dead item 1)

    // compass: a slim band; the strip sits at the band's centre and slides by the heading (see setState)
    const compass = el('div', engineString('s_0a9eab204b28'));
    compass.innerHTML = engineString('s_cfa898107d6c');
    const band = el('div', engineString('s_2108e241e445'));
    this.compassStrip = el('div', engineString('s_e9739b46a53c'));
    for (let deg = -360; deg < 720; deg += 15) {
      const major = deg % 45 === 0;
      const tick = el('i', engineString('s_596ce7910054', [major ? engineString('s_a318b285a298') : '']));
      tick.style.left = `calc(${deg + 360} * var(--ppd))`;
      this.compassStrip.append(tick);
    }
    for (let lap = -1; lap <= 1; lap++) for (const [deg, label, major] of CARDINALS) {
      const c = el('div', engineString('s_002ee98b1117', [major ? '' : engineString('s_09961a79c5fc'), label === 'N' ? engineString('s_ac5b2b82539a') : ''])); c.textContent = label;
      c.style.left = `calc(${deg + lap * 360 + 360} * var(--ppd))`;
      this.compassStrip.append(c);
    }
    this.band = band;
    band.append(this.compassStrip);
    this.markHouse = el('div', engineString('s_aeeaee77b482'), SVG_HOUSE); band.append(this.markHouse);
    this.markPaw = el('div', engineString('s_a075e0ecc9be'), SVG_PAW); band.append(this.markPaw);
    band.append(el('div', engineString('s_b249b8043764')));
    compass.append(band);
    compass.append(el('div', engineString('s_6da8a22f6082')));
    // px/deg scales with the band (90 vw on a phone, fixed on desktop): ticks and cardinals are laid out in `--ppd` units
    const fit = (): void => { const w = band.clientWidth; this.bandW = w; if (!w) return; this.ppd = w / BAND_DEGREES; band.style.setProperty('--ppd', `${this.ppd}px`); this.last.headingDeg = undefined; this.lastMark.house = this.lastMark.paw = Number.NaN; };
    const resize = new ResizeObserver(fit); resize.observe(band);
    this.scope.onDispose(() => { resize.disconnect(); });
    fit();
    this.range = el('div', engineString('s_3552e88da7e6')); compass.append(this.range);
    mountUi(compass, this.scope, r);

    this.feed = el('div', engineString('s_3b5ab2caa819')); mountUi(this.feed, this.scope, r);

    // health
    const health = el('div', engineString('s_c05bd7c3364f'));
    health.innerHTML = engineString('s_ac30287e22b2');
    this.healthVal = q(health, '.v'); this.healthBar = q(health, '.ws-bar i'); this.healthMax = q(health, '.ws-game-hval small');
    this.healthPanel = health; health.classList.add('hp-fade', 'hp-gone'); // E319: hidden at full health (setState)
    mountUi(health, this.scope, r);

    // ammo
    const ammo = el('div', engineString('s_bc430be3e44e'));
    ammo.innerHTML = engineString('s_257c5b64d234', ['', '', this.opts.maxBolts, this.opts.maxBolts]);
    this.ammoPanel = ammo;
    this.ammoCount = q(ammo, '.ws-game-count'); this.ammoNum = q(this.ammoCount, '.c'); this.ammoStatus = q(ammo, '.ws-game-status'); this.ammoStatusText = q(ammo, '.ws-game-status .s'); this.reloadBar = q(ammo, '.ws-game-rbar i');
    this.ammoLabel = q(ammo, '.ws-label .l'); this.ammoWeapon = q(ammo, '.ws-game-weapon'); this.ammoMax = q(ammo, '.m'); this.ammoReserve = q(ammo, '.ws-game-reserve');
    this.ammoWeapon.textContent = this.opts.weaponUi.name; this.ammoLabel.textContent = this.opts.weaponUi.ammo?.label ?? '';
    this.pipBox = q(ammo, '.ws-game-pips');
    this.buildPips(this.opts.maxBolts);
    mountUi(ammo, this.scope, r);

    // crosshair
    this.cross = el('div', engineString('s_bd0231f0183c'), engineString('s_0b94de84aa21'));
    this.killX = q(this.cross, '.ws-game-x');
    mountUi(this.cross, this.scope, r);
    this.hitRing = el('div', engineString('s_4e8f738d8c5f')); mountUi(this.hitRing, this.scope, r);
    this.aim = el('div', engineString('s_d1e1eef88c48')); mountUi(this.aim, this.scope, r);

    this.prompt = el('div', engineString('s_98730d3255b2')); mountUi(this.prompt, this.scope, r);
    // A14: Developer-only, so a section of the frame meter's panel (perfDock.ts) with the pill's red mark, not a title over the world
    this.boundary = el('div', engineString('s_befab9df4f5c'), engineString('s_9029b332a959')); this.boundary.hidden = true; perfDockSection(this.boundary, this.scope, -8);
    const toasts = el('div', engineString('s_dcccdb8a40d1')); mountUi(toasts, this.scope, r); this.toasts = new ToastStack(toasts); this.toastBox = toasts;
    this.flash = el('div', engineString('s_18547caf898d')); mountUi(this.flash, this.scope, r);

    // pause = the in-game menu on its Settings tab (src/client/engine/ui/Menu.ts, attached by main.ts as `hud.menu`):
    // the touch PAUSE button (TouchControls) and a released pointer lock; Escape (and M / I) is the menu's own key listener,
    // gated by `keyGate` below (E130 — the HUD's Esc here opened the menu the menu's listener then closed, E32)
    this.scope.listen(document, 'ws:pause', () => { if (this.entered) this.setPaused(!this.paused); });
    // the page went to the background (core/GpuRecovery.ts): pause, never unpause
    this.scope.listen(document, 'ws:background', () => { if (this.entered && !this.paused) this.setPaused(true); });
    // QB8: the error modal pauses the world under it; its KEEP PLAYING resumes only a pause the modal itself made
    let errorPaused = false;
    this.scope.listen(document, 'ws:error-pause', () => { if (this.entered && !this.paused) { this.setPaused(true); errorPaused = true; } });
    this.scope.listen(document, 'ws:error-keep', () => { if (errorPaused && this.paused) this.setPaused(false); errorPaused = false; });
    this.scope.listen(document, WEATHER_EVENT, (e) => { if (e instanceof CustomEvent) this.setWeather(e.detail as WeatherHUD); });
  }

  /** the storm chip + GET LOW warning (see WeatherHUD); normally driven by the `ws:weather` event */
  setWeather(w: WeatherHUD): void {
    if (!this.weather) {
      if (!w.chip && !w.getLow) return;
      const chip = el('div', engineString('s_03ce5d3c17e3'), engineString('s_0280c7c593d6', [SVG_STORM]));
      const low = el('div', engineString('s_ee89d1fa2407'), engineString('s_d6d50babe1cf', [SVG_WARN]));
      mountUi(chip, this.scope, this.root); mountUi(low, this.scope, this.root);
      this.weather = { chip, title: q(chip, '.ws-game-wt'), sub: q(chip, '.ws-game-ws'), low, last: '' };
    }
    const W = this.weather;
    const key = `${w.chip?.title ?? ''}|${w.chip?.sub ?? ''}|${w.chip?.tone ?? ''}|${String(w.getLow)}`;
    if (key === W.last) return;
    W.last = key;
    W.chip.classList.toggle('show', w.chip !== null);
    if (w.chip) {
      W.title.textContent = w.chip.title; W.sub.textContent = w.chip.sub;
      W.chip.classList.toggle('storm', w.chip.tone === 'storm');
    }
    W.low.classList.toggle('show', w.getLow);
  }

  private buildPips(n: number): void {
    this.pipBox.replaceChildren(); this.pips.length = 0;
    for (let i = 0; i < n; i++) { const p = el('i'); this.pipBox.append(p); this.pips.push(p); }
  }

  // ── per-frame state ──
  setState(s: HUDState): void {
    const L = this.last;
    this.toasts.tick();
    // the held weapon: label / name / magazine size / reserve (Weapons.ts) — rebuilds the pips + bars when the weapon changes
    const maxBolts = s.maxBolts ?? this.opts.maxBolts, label = s.weaponUi.ammo?.label ?? '', name = s.weaponUi.name, segments = s.weaponUi.ammo?.segments ?? 0, reserve = s.reserve ?? 0;
    if (maxBolts !== L.maxBolts || label !== L.ammoLabel || name !== L.weaponName || segments !== L.segments) {
      L.maxBolts = maxBolts; L.ammoLabel = label; L.weaponName = name; L.segments = segments; L.statusKey = undefined; L.bolts = undefined;
      this.ammoLabel.textContent = label; this.ammoWeapon.textContent = name; this.ammoMax.textContent = String(maxBolts);
      if (this.pips.length !== maxBolts) this.buildPips(maxBolts);
      if (this.bar) { this.bar.label.textContent = label; this.bar.weapon.textContent = name; this.bar.max.textContent = String(maxBolts); this.buildSegs(segments); }
    }
    if (reserve !== L.reserve) { L.reserve = reserve; const txt = reserve > 0 ? `+ ${reserve}` : ''; this.ammoReserve.textContent = txt; if (this.bar) this.bar.reserve.textContent = txt; }
    // compass: +Z (the south-gate spawn's forward, yaw π) is north; turning left decreases the heading
    let deg = 180 - (s.yaw * 180) / Math.PI; deg = ((deg % 360) + 360) % 360;
    const degR = Math.round(deg * 2) / 2;
    if (degR !== L.headingDeg) {
      L.headingDeg = degR;
      this.compassStrip.style.transform = `translateX(${-(deg + 360) * this.ppd}px)`;
    }
    this.updateMarkers(s, deg);
    const maxHp = s.maxHealth ?? 100;
    if (s.health !== L.health || maxHp !== L.maxHealth) {
      if (maxHp !== L.maxHealth) { L.maxHealth = maxHp; this.healthMax.textContent = engineString('s_9c6a243a6829', [maxHp]); }
      L.health = s.health;
      const h = Math.max(0, Math.min(maxHp, s.health)), pct = (h / maxHp) * 100;
      this.healthVal.textContent = String(Math.round(h));
      this.healthBar.style.width = `${pct}%`;
      this.healthBar.classList.toggle('low', pct <= 30);
      this.syncBar('health');
    }
    // E319: VITALS only while hurt — full → VITALS_HIDE_MS → a fade → gone; a hit shows them the same frame
    const now = performance.now();
    if (s.health < maxHp) this.hpFullAt = null; else this.hpFullAt ??= now;
    const fullFor = this.hpFullAt === null ? -1 : now - this.hpFullAt;
    const hp = fullFor < VITALS_HIDE_MS ? 'show' : fullFor < VITALS_HIDE_MS + VITALS_FADE_MS ? 'fade' : 'gone';
    if (hp !== this.hpShown) { this.hpShown = hp; this.paintVitals(); }
    const noAmmo = s.bolts === undefined;
    if (noAmmo !== L.noAmmo) { L.noAmmo = noAmmo; this.ammoPanel.style.display = noAmmo ? 'none' : ''; if (this.bar) this.bar.bolts.style.display = noAmmo ? 'none' : ''; }
    const bolts = s.bolts ?? 0;
    if (!noAmmo && bolts !== L.bolts) {
      L.bolts = bolts;
      this.ammoNum.textContent = String(bolts);
      this.ammoCount.classList.toggle('empty', bolts <= 0);
      this.pips.forEach((p, i) => { p.classList.toggle('off', i >= bolts); });
      this.syncBar('bolts');
    }
    const statusKey = noAmmo ? 'loaded' : bolts <= 0 && !s.loaded ? 'empty' : s.reloading ? 'reloading' : s.loaded ? 'loaded' : 'spent';
    if (statusKey !== L.statusKey) {
      L.statusKey = statusKey;
      this.ammoStatus.className = `ws-game-status ${statusKey === 'empty' ? 'empty' : statusKey === 'reloading' ? 'reloading' : ''}`;
      const bow = label === 'Bolts' || label === 'Pitch bolts' || label === 'Broadheads', arrows = label === 'Arrows'; // the crossbow's kinds (Pine Hollow's loadout), the longbow's quiver
      this.ammoStatusText.textContent = statusKey === 'empty' ? (bow ? engineString('s_57bb4fd702ce') : arrows ? engineString('s_c3fd1e1d6aed') : reserve > 0 ? engineString('s_350eeb63fef0') : engineString('s_051534c4e5f7')) : statusKey === 'reloading' ? (bow ? engineString('s_9e0902cd9a2b') : engineString('s_a4b350a14964')) : statusKey === 'loaded' ? (bow ? engineString('s_d01476dfee7e') : arrows ? engineString('s_ef2a15f49495') : engineString('s_5fa7aac5375c')) : (bow ? engineString('s_a210214fc7c6') : engineString('s_01d5aca1d51d'));
      this.syncBar('status');
    }
    this.syncReloadChip(s);
    const rp = s.reloading ? (s.reloadProgress ?? 0) : 0;
    if (rp !== L.reloadProgress) { L.reloadProgress = rp; this.reloadBar.style.width = `${rp * 100}%`; }
    // crosshair spread
    const target = (s.ads ? 4 : 7) + (s.speed ?? 0) * 7 + (s.reloading ? 6 : 0);
    if (Math.abs(target - this.spread) > 0.05) { this.spread += (target - this.spread) * 0.2; this.cross.style.setProperty('--gap', `${this.spread.toFixed(1)}px`); }
    if (s.ads !== L.ads) { L.ads = s.ads; this.cross.classList.toggle('ads', s.ads === true); }
    if (s.prompt !== L.prompt) {
      L.prompt = s.prompt;
      if (s.prompt) {
        const key = /^\[(\w+)\]\s*/.exec(s.prompt);
        this.prompt.replaceChildren();
        if (key) {
          const badge = document.createElement('b'); badge.textContent = key[1] ?? '';
          this.prompt.append(badge, document.createTextNode(s.prompt.slice(key[0].length)));
        } else this.prompt.textContent = s.prompt;
        this.prompt.classList.add('show');
      }
      else this.prompt.classList.remove('show');
    }
    if (this.hitTimer > 0 && (this.hitTimer -= 1) === 0) this.cross.classList.remove('hit', 'head');
  }

  /** touch (E42): heart · 100 · bar · VITALS top-left under PAUSE / the frame meter, and under it (ranged kit) BOLTS · segments · 27 / 30 · bolt.
   *  The base's first two rows of the status column (src/client/engine/ui/hudSlots.ts; docked whenever the touch layer mounts — never
   *  on a mouse device); the numbers are HUD state, so the HUD owns them. */
  private mountBar(): void {
    const vitals = el('div', engineString('s_4c6b96a54dfa'), engineString('s_92890f1e67f6', [SVG_HEART]));
    const L = this.last, segN = L.segments ?? this.opts.weaponUi.ammo?.segments ?? 0, reserve = L.reserve ?? 0;
    const bolts = el('button', engineString('s_e99685b6c3aa'), engineString('s_adf21edee32f', ['', '', '<i></i>'.repeat(segN), this.opts.maxBolts, L.maxBolts ?? this.opts.maxBolts, reserve > 0 ? engineString('s_850875985389', [reserve]) : '', SVG_BOLT]));
    q(bolts, '.ws-game-weapon').textContent = L.weaponName ?? this.opts.weaponUi.name;
    q(bolts, '.ws-game-tiny .l').textContent = L.ammoLabel ?? this.opts.weaponUi.ammo?.label ?? '';
    bolts.type = 'button'; bolts.disabled = true;
    listenReloadChip(this.scope, bolts, () => {
      if (this.canReloadChip && this.entered && !this.paused && !app.ui.blocking) app.input.pressGesture('reload');
    });
    hudSlots.widget('band.2', vitals, ROW.vitals, this.scope); hudSlots.widget('band.2', bolts, ROW.ammo, this.scope);
    if (this.last.noAmmo) bolts.style.display = 'none';
    this.bar = { vitals, hval: q(vitals, '.ws-game-num'), hbar: q(vitals, '.ws-game-vbar i'), bolts, glyph: q(bolts, '.ws-game-glyph'), bcount: q(bolts, '.c'), segs: Array.from(bolts.querySelectorAll<HTMLElement>('.ws-game-segs i')), segBox: q(bolts, '.ws-game-segs'), label: q(bolts, '.ws-game-tiny .l'), weapon: q(bolts, '.ws-game-weapon'), max: q(bolts, '.m'), reserve: q(bolts, '.ws-game-reserve') };
    this.syncBar('health'); this.syncBar('bolts'); this.syncBar('status'); this.paintVitals();
  }
  private syncReloadChip(s: HUDState): void {
    const b = this.bar; if (!b) return;
    const magazine = s.weaponUi.ammo?.magazine === true && s.bolts !== undefined;
    const partEmpty = magazine && (s.bolts ?? 0) < (s.maxBolts ?? this.opts.maxBolts);
    const canReload = partEmpty && !s.reloading && (s.reserve ?? 0) > 0;
    if (magazine !== this.magazineChip) {
      this.magazineChip = magazine;
      b.bolts.classList.toggle('magazine', magazine);
      b.glyph.innerHTML = magazine ? SVG_RELOAD : SVG_BOLT;
      b.glyph.classList.toggle('ws-game-reload', magazine);
    }
    const hideGlyph = magazine && !partEmpty;
    if (b.glyph.hidden !== hideGlyph) b.glyph.hidden = hideGlyph;
    b.bolts.classList.toggle('reloading', s.reloading);
    if (b.bolts.disabled === canReload) b.bolts.disabled = !canReload;
    this.canReloadChip = canReload;
    const label = magazine ? `${s.weaponUi.name} · ${engineString(s.reloading ? 's_a4b350a14964' : 's_4027f515418b')}` : s.weaponUi.name;
    if (b.bolts.getAttribute('aria-label') !== label) b.bolts.setAttribute('aria-label', label);
  }

  /** The VITALS panel's glass (a backdrop blur over the live game canvas) compiles a compositor pipeline the first time
   *  it draws. Hidden at full health (E319), it first drew on the first hit taken, where a cold desktop Chromium GPU
   *  process spent one 83.4 ms frame compiling it (desktop fps census, 2026-11-03). Drawn once as the player enters, at
   *  opacity 0.002 (under half an 8-bit step, so no pixel changes) for about nine frames, the compile happens there. */
  private static glassWarmed = false;
  private warmGlass(): void {
    const panel: unknown = this.healthPanel;
    if (HUD.glassWarmed || !(panel instanceof HTMLElement) || this.hpShown === 'show') return;
    HUD.glassWarmed = true;
    panel.classList.add('hp-warm');
    this.scope.timeout(150, () => { panel.classList.remove('hp-warm'); });
  }

  /** E319: the desktop VITALS panel and the touch VITALS strip follow `hpShown` (fading out, then out of the layout) */
  private paintVitals(): void {
    for (const e of [this.healthPanel, this.bar?.vitals]) {
      if (e === undefined) continue;
      e.classList.toggle('hp-fade', this.hpShown !== 'show'); e.classList.toggle('hp-gone', this.hpShown === 'gone');
    }
  }
  /** the touch strip's bars over the magazine: 4 for the crossbow, 6 for the rifle (rebuilt on a weapon change) */
  private buildSegs(n: number): void {
    const b = this.bar; if (!b || b.segs.length === n) return;
    b.segBox.innerHTML = '<i></i>'.repeat(n); b.segs = Array.from(b.segBox.querySelectorAll<HTMLElement>('i'));
    this.syncBar('bolts');
  }

  private syncBar(what: 'health' | 'bolts' | 'status'): void {
    const b = this.bar, L = this.last;
    if (!b) return;
    if (what === 'health') {
      const max = L.maxHealth ?? 100, h = Math.max(0, Math.min(max, L.health ?? max)), pct = (h / max) * 100;
      b.hval.textContent = String(Math.round(h));
      b.hbar.style.width = `${pct}%`;
      b.hbar.classList.toggle('low', pct <= 30);
    } else if (what === 'bolts') {
      const max = L.maxBolts ?? this.opts.maxBolts, n = L.bolts ?? max;
      b.bcount.textContent = String(n);
      const lit = n <= 0 ? 0 : Math.max(1, Math.floor((n / max) * b.segs.length + 1e-6));
      b.segs.forEach((seg, i) => { seg.classList.toggle('off', i >= lit); });
    } else {
      b.bolts.classList.toggle('empty', L.statusKey === 'empty');
      b.bolts.classList.toggle('reloading', L.statusKey === 'reloading');
    }
  }

  /** world positions of the live animals — the compass pins a paw at the nearest one within `PAW_RANGE` (empty = no paw) */
  setAnimals(list: { x: number; z: number }[]): void { this.animals = list; }

  /** compass markers: the nearest cabin (house + "CABIN · 180 m") and the nearest animal (paw), each at its bearing on the band */
  private updateMarkers(s: HUDState, heading: number): void {
    const { x, z } = s.pos;
    let hasCabin = false, cabinDistance = 0, cabinBearing = 0;
    for (const c of CABIN_SITES) {
      const d = Math.hypot(c.x - x, c.z - z);
      if (!hasCabin || d < cabinDistance) { hasCabin = true; cabinDistance = d; cabinBearing = bearingTo(x, z, c.x, c.z); }
    }
    let hasPaw = false, pawDistance = 0, pawBearing = 0;
    if (s.nearest) { if (s.nearest.distance <= PAW_RANGE) { hasPaw = true; pawDistance = s.nearest.distance; pawBearing = s.nearest.bearing; } }
    else for (const a of this.animals) {
      const d = Math.hypot(a.x - x, a.z - z);
      if (d <= PAW_RANGE && (!hasPaw || d < pawDistance)) { hasPaw = true; pawDistance = d; pawBearing = bearingTo(x, z, a.x, a.z); }
    }
    this.placeMark(this.markHouse, 'house', hasCabin ? cabinBearing - heading : Number.NaN);
    this.placeMark(this.markPaw, 'paw', hasPaw ? pawBearing - heading : Number.NaN);
    const metres = hasCabin ? Math.round(cabinDistance) : null;
    if (!Object.is(metres, this.cabinMetres)) {
      this.cabinMetres = metres;
      const range = metres === null ? '' : `Cabin · ${metres} m`;
      if (range !== this.lastMark.range) { this.lastMark.range = range; this.range.textContent = range; this.range.classList.toggle('show', range !== ''); }
    }
  }

  private placeMark(m: HTMLElement, key: 'house' | 'paw', rel: number): void {
    let px = Number.NaN;
    if (!Number.isNaN(rel)) {
      const r = ((rel + 540) % 360) - 180; // −180..180 around the heading
      if (this.bandW < 0) this.bandW = this.band.clientWidth; // before the observer's first report: measured once, then by fit() (0 while the band is hidden)
      const half = this.bandW / 2 - MARKER_INSET;
      px = Math.round(Math.max(-half, Math.min(half, r * this.ppd)) * 2) / 2;
    }
    if (px === this.lastMark[key] || (Number.isNaN(px) && Number.isNaN(this.lastMark[key]))) return;
    this.lastMark[key] = px;
    if (Number.isNaN(px)) m.classList.remove('show');
    else { m.style.transform = `translateX(${px}px)`; m.classList.add('show'); }
  }

  /** range readout under the crosshair: "BOAR · 15 M" (null hides it) */
  setAimInfo(info: { kind: string; distance: number } | null): void {
    const text = info ? `${info.kind} · ${Math.round(info.distance)} m` : '';
    if (text === this.aimText) return;
    this.aimText = text;
    if (text) { this.aim.textContent = text; this.aim.classList.add('show'); } else this.aim.classList.remove('show');
  }

  showHitMarker(headshot: boolean, killed: boolean): void {
    this.cross.classList.add('hit'); this.cross.classList.toggle('head', headshot);
    this.hitTimer = 10;
    this.hitRing.classList.remove('show'); void this.hitRing.offsetWidth; this.hitRing.classList.add('show');
    if (killed) { this.killX.classList.remove('show'); void this.killX.offsetWidth; this.killX.classList.add('show'); }
  }

  killFeed(text: string): void {
    const item = el('div', engineString('s_b48e7827330f'));
    let at = 0;
    for (const match of text.matchAll(/\b(headshot|kill|killed)\b/gi)) {
      const word = document.createElement('b'); word.textContent = match[0];
      item.append(document.createTextNode(text.slice(at, match.index)), word); at = match.index + match[0].length;
    }
    item.append(document.createTextNode(text.slice(at)));
    this.feed.prepend(item);
    while (this.feed.children.length > 4) this.feed.lastElementChild?.remove();
    this.scope.timeout(4200, () => { item.classList.add('out'); this.scope.timeout(500, () => { item.remove(); }); });
  }

  /** one queue (src/client/engine/ui/ToastStack.ts: ≤ 3 up, the older ones dimmed, stepping down under the elite / boss bars), placed per
   *  A1 (E130): right-aligned under the quest chip */
  toast(text: string, tone: ToastTone = 'plain'): void { this.placeToasts(); this.toasts.push(text, tone); }

  /** A red strip under the top bar, shown only with Settings ▸ Developer on (G168: the technical reason behind a player toast).
   *  The text is content-supplied and set through textContent; a new alert replaces the last. */
  devAlert(text: string): void { (this.alert ??= mountDeveloperAlert(this.scope))(text); }
  private alert: ((text: string) => void) | undefined;

  /** the level's HUD accent for the big item cards (a hex; null: the HUD cyan) — the game sets it from the level's declared accent */
  cardAccent: string | null = null;
  private cardPop: ItemCardPop | null = null;
  /** SF28 (G87; the only pickup look since Jake's G181 pick, E450): a platform pickup (equipment, harvest drops) as the big
   *  item card under the top bar, in the level's accent */
  pickupCard(spec: ItemCardSpec): void {
    this.cardPop ??= new ItemCardPop(this.root, this.scope);
    this.cardPop.show(spec, engineString('s_item_card_picked'), this.cardAccent);
  }

  /** A1 (E130): the toasts hang right-aligned under the quest chip (placed by QuestUI under the minimap; hidden, its slot
   *  still is) — on a shard without one, under the minimap. Read at each toast: every layout puts them differently */
  private placeToasts(): void {
    const chip = this.root.querySelector('.ws-quest-obj'), anchor = chip ?? this.root.querySelector('.ws-minimap');
    if (anchor === null) return;
    const r = anchor.getBoundingClientRect(), host = this.root.getBoundingClientRect();
    if (r.height === 0) return;
    this.toastBox.style.setProperty('--ws-toast-top', `${Math.round(r.bottom - host.top + (chip ? 8 : 12))}px`); // the rim's ticks poke 6–8 px out
    this.toastBox.style.setProperty('--ws-toast-right', `${Math.round(host.right - r.right)}px`);
  }


  damageFlash(): void { this.flash.classList.remove('show'); void this.flash.offsetWidth; this.flash.classList.add('show'); }
  /** developer mode only (E140, the user's verdict on dead item 2): players get no edge warning. main.ts calls this every
   *  frame, so the Developer switch shows / hides it live. */
  private boundaryShown = false;
  setBoundaryWarning(visible: boolean): void {
    const on = visible && isDev();
    if (on === this.boundaryShown) return; // play.ts calls this every frame
    this.boundaryShown = on; this.boundary.hidden = !on; this.boundary.classList.toggle('show', on); perfDockAlert(this.boundary, this.scope, on);
  }

  set menu(m: GameMenu) { this._menu = m; m.onClose = () => { this.onResume?.(); tap.resumed?.(); }; m.onExit = () => { if (m.inPractice) this.exitToExplore(); else this.exitToMenu(); }; }
  get menu(): GameMenu { const m = this._menu; if (!m) throw new Error('HUD: no menu attached (hud.menu = …)'); return m; }
  setPaused(paused: boolean): void { if (!this._menu || !this.entered) return; if (paused) this._menu.open('settings'); else this._menu.close(); }
  get paused(): boolean { return this._menu?.isOpen ?? false; }

  /**
   * Title screen: the shard deck IS the menu (src/client/game/titleDeck.ts — the same deck the cold launch shows, E318). A horizontal
   * carousel of shard cards over the selected card's hero art (the world is paused underneath); ENTER WORLD plays this
   * shard or opens another in a fresh page, EXPLORE WORLD opens the viewer (project/archive/2026-09-23-explore-world.md).
   * `stats` is accepted for API compatibility.
   */
  showIntro(onEnter: () => void, _stats?: IntroStats): void {
    this.onEnter = onEnter;
    this.root.classList.add('intro');
    if (this.titleDeck === null) throw new Error('HUD.showIntro: the game installs hud.titleDeck first');
    const deck = this.titleDeck({
      enter: () => { this.enter(); },
      explore: () => { this.leaveForExplore(); },
      settings: () => { openBootSettings(); }, // E55: the reload-to-apply picks
    });
    mountUi(deck.root, this.scope, this.root);
    this.intro = deck.root;
    this.deck = deck;
    deck.start();
  }

  /** EXPLORE WORLD: the title goes away but the play HUD stays hidden (`#hud.intro` is kept) — Explore draws its own overlay */
  private leaveForExplore(): void {
    if (!this.intro) return;
    const intro = this.intro; this.intro = undefined; this.deck?.dispose(); this.deck = undefined;
    intro.classList.add('hide');
    this.scope.timeout(Math.max(700, HERO_FADE_MS * 2), () => { intro.remove(); });
    this.onExplore?.();
  }

  /** skip the title straight into Explore (`?explore=` deep links) */
  startExplore(): void { this.root.classList.add('intro'); if (this.intro) this.leaveForExplore(); else this.onExplore?.(); }

  private enter(): void {
    if (!this.intro) return;
    const intro = this.intro; this.intro = undefined; this.deck?.dispose(); this.deck = undefined;
    intro.classList.add('hide');
    this.scope.timeout(Math.max(700, HERO_FADE_MS * 2), () => { intro.remove(); });
    this.root.classList.remove('intro');
    this.entered = true;
    this.onEnter?.();
  }

  /** skip the intro (`?skipintro`, `?tour`, a GPU-recovery reload): straight into the world. `onEnter` is what the title's
   *  ENTER WORLD runs once pause → "Exit to main menu" brings the title back — without it that exit froze the game (E86) */
  /** what ENTER WORLD runs, for a boot that opens on Explore instead of the title (a shard switch into EXPLORE WORLD) */
  setOnEnter(onEnter: () => void): void { this.onEnter = onEnter; }

  markEntered(onEnter?: () => void): void { if (onEnter) this.onEnter = onEnter; this.entered = true; this.root.classList.remove('intro'); }

  /** E155: the deck picked this shard while it was resident: into the world at once, as its own ENTER WORLD would */
  enterNow(): void {
    if (this.intro) {
      // the deck was parked on the card the player left for: its own card back first, so the fade-out shows this shard's art
      const d = this.deck, own = d ? d.cards.map((c): string => c.slug).indexOf(activeLevel().id) : -1;
      if (d && own !== -1 && own !== d.index) d.select(own, false);
      this.enter();
      return;
    }
    if (this.entered) return;
    this.markEntered();
    this.onEnter?.();
  }

  /** Enter the selected shard with its starter weapon in the shared practice room. */
  enterArenaNow(): void {
    this.enterNow();
    if (this.entered) this.onArena?.();
  }

  /** Pause → main menu hands the session back to its host. A host without that port keeps its local intro. */
  exitToMenu(): void {
    if (!this.entered || this.intro) return;
    if (this.onExitToMain !== undefined) {
      this.entered = false;
      this.onExitToMain();
      return; // The replacement document owns cleanup; even menu.close disposes scopes.
    }
    this._menu?.close(true);
    this.entered = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.onExitToMenu?.(); // local-intro hosts hush their world
    if (this.onEnter) this.showIntro(this.onEnter);
  }

  /** The practice pause menu returns straight to Explore's hub, leaving the play HUD behind. */
  exitToExplore(): void {
    if (!this.entered || this.intro) return;
    this._menu?.close(true);
    this.entered = false;
    this.root.classList.add('intro');
    if (document.pointerLockElement) document.exitPointerLock();
    this.onExitToMenu?.();
    this.onExplore?.();
  }
}
