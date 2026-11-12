/**
 * The Wildshard main menu (SHARD-PLATFORM SF21a; Jake's picks G79 / G88, board `art/menu/round-7-new-main-menu/B-*`):
 * a first-person crossroads hero, the WILDSHARD logo, two big side-by-side cards SHARD SELECT and INFINITE WILDSHARD,
 * and SETTINGS. With Developer off INFINITE WILDSHARD is hidden until SF22's gates pass (G63), and SHARD SELECT is one
 * wide card. SHARD SELECT opens today's shard deck (src/client/game/titleDeck.ts), unchanged (G58 / G64): the deck sits under the
 * menu, laid out (so its carousel centres), and a MAIN MENU button beside its SETTINGS comes back.
 *
 *   const view = buildTitleMenu({ ...deck options, onGrid })   // a TitleDeckView: the cold title and pause ▸ EXIT TO MAIN
 *
 * Both ways in (src/client/app/entry.ts's cold title and the HUD's showIntro, wired in src/client/game/session/loadout.ts) build it, so the
 * main menu is the first screen either way. A rebuild (Settings ▸ Developer flips it) keeps the screen it was on.
 * With Developer on, the day's WHAT'S NEW banner sits under the logo (SF60 / G214, src/client/game/whatsNewBanner.ts).
 * A compact DEV switch beside SETTINGS flips Settings ▸ Developer from the menu itself (E483).
 */
import { titleAssetURL } from './titleAssets';
import { mobileDevice } from '@wildshard/engine/boot/titleArrival';
import { dropFirstPlay, firstPlayDone, startFirstPlay } from '@wildshard/engine/boot/firstPlayMark';
import { lowPowerOn } from '@wildshard/engine/core/graphicsMode';
import { askNameOnce, nameAskDue } from '@wildshard/engine/ui/namePrompt';
import { lastEnd } from '@wildshard/engine/boot/lastEnd';
import { setDev } from '@wildshard/engine/core/devMode';
import { buildTitleDeck, titleCards, type TitleCard, type TitleDeck, type TitleDeckOptions } from './titleDeck';
import { gridEntryShown, menuMode, gridMode } from './grid/menu';
import { dropGridIntent, enterGrid, gridRecoveryLoop } from './grid/pageEntry';
import { worldHosted } from './grid/oneWayIn';
import { pageScope } from '@wildshard/engine/app/resources';
import { saves } from '@wildshard/engine/saves/runtime';
import { findTitleManifest, titleManifests } from './shard/titleList';
import { titlePrefetchChoice, titlePrefetchTarget } from './grid/titlePrefetchChoice';

import { GAME_STRINGS } from '../../shared/game/strings';
import { WHATS_NEW, type WhatsNew } from './whatsNew';
import { buildWhatsNewBanner, type HiddenStore } from './whatsNewBanner';
import './mainMenu.css';
/** MOBILE-GRAPHICS MG4 (Jake: "put a fucking banner on the homepage saying low power mode is on. You're automatically going
 *  into low graphics") */
const LOW_POWER_BANNER = 'Low Power Mode is on, so you\'re on Low graphics. Turn it off for High.';
/** the hero (G341 layouts, G344 interim pick): real in-engine aerials over the central roundabout at a phone-1x lens
 * (art/main-menu-hero/round-3-square): LS-c full-bleed on landscape screens, the square SQ-c as the centre band on
 * portrait screens. mainMenu.css picks one per orientation, so a screen downloads only its own image. */
export const MAIN_MENU_HERO: string = titleAssetURL('/assets/title/main-crossroads-landscape.jpg');
/** Square title artwork shared by the menu deck. */
export const MAIN_MENU_SQUARE_HERO: string = titleAssetURL('/assets/title/main-crossroads-square.jpg');

const CARDS_ICON = '<svg viewBox="0 0 64 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="6" y="11" width="18" height="27" rx="2" transform="rotate(-16 15 24)"/><rect x="40" y="11" width="18" height="27" rx="2" transform="rotate(16 49 24)"/><rect x="22" y="4" width="20" height="31" rx="2" fill="rgba(6,10,18,0.85)"/></g></svg>';
const GRID_CELLS = [0, 1, 2].flatMap((r) => [0, 1, 2].map((c) => `<rect x="${17 + c * 11}" y="${6 + r * 13}" width="8" height="9" rx="1"/>`)).join('');
const GRID_DOTS = [10, 24, 38].flatMap((y) => [`<circle cx="9" cy="${y + 1}" r="1.4"/>`, `<circle cx="55" cy="${y + 1}" r="1.4"/>`]).join('');
const GRID_ICON = `<svg viewBox="0 0 64 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2">${GRID_CELLS}</g><g fill="currentColor">${GRID_DOTS}</g></svg>`;

/** The two title-menu destinations. */
export type MainMenuScreen = 'main' | 'select';
/** the screen this page's title is on: a rebuild (Developer flipped in Settings) comes back to it */
let screen: MainMenuScreen = 'main';

/** Caller-owned title deck and navigation options. */
export interface TitleMenuOptions extends Omit<TitleDeckOptions, 'cards'> {
  /** the deck's cards (default: `titleCards()`, Developer read live) */
  readonly cards?: TitleDeckOptions['cards'];
  /** INFINITE WILDSHARD's tap: boots the grid from its one-shot intent (src/client/game/plugin/context.ts `enterGrid`) */
  readonly onGrid: () => void;
  /** which screen to open on (default: the one this page was last on, the main menu at first) */
  readonly screen?: MainMenuScreen;
  /** SF60 / G214: the WHAT'S NEW banner's lines (default: today's, src/client/game/whatsNew.ts) and its hide store (tests) */
  readonly whatsNew?: WhatsNew;
  readonly whatsNewStore?: HiddenStore;
}

/** the title deck's view with the main menu over it (the HUD's TitleDeckView: keys, refresh, enter) */
export interface TitleMenu {
  readonly root: HTMLElement;
  readonly cards: TitleDeck['cards'];
  readonly index: number;
  readonly select: (i: number, smooth?: boolean) => void;
  readonly activate: () => void;
  readonly start: () => void;
  readonly dispose: () => void;
  /** the screen on show (tests, the proof script) */
  readonly screen: MainMenuScreen;
  readonly show: (next: MainMenuScreen) => void;
}

function required<T extends HTMLElement>(root: ParentNode, selector: string, type: new () => T): T {
  const found = root.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Main menu: missing ${selector}`);
  return found;
}

/** Build the shared title menu from its supplied deck and callbacks. */
export function buildTitleMenu(opts: TitleMenuOptions): TitleMenu {
  const owner = pageScope.child('title-prefetch');
  let leavingTitle = false;
  let stopReadAhead: (() => void) | undefined;
  const leaveTitle = (): void => { leavingTitle = true; stopReadAhead?.(); };
  const mode = opts.mode ?? menuMode;
  const { notice, onGrid, screen: first, cards = titleCards(), whatsNew = WHATS_NEW, whatsNewStore, ...deckOpts } = opts;
  let firstEntry: TitleCard | null = null; // MG5: the card the first PLAY is entering
  // leaving the title for a world resets it: pause ▸ EXIT TO MAIN opens on the main menu again
  // MG4 / MG5: a phone, by the rule the tier uses (core/tier.ts), read here without the tier's render tables (the title's graph)
  const phone = mobileDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  const deck = buildTitleDeck({ ...deckOpts, cards,
    // MG5: an entry that is not the first PLAY's own drops a first play armed and never reached
    onEnter: (card) => { if (card !== firstEntry) dropFirstPlay(); firstEntry = null; leaveTitle(); screen = 'main'; deckOpts.onEnter(card); },
    onExplore: (card) => { dropFirstPlay(); leaveTitle(); screen = 'main'; deckOpts.onExplore(card); } });
  const grid = gridEntryShown(mode());
  // GO7 (DG4): on a build with a world, Infinite Wildshard shows once the world says it hosts the grid; until then it stays hidden.
  let hosted = false;
  const world = (globalThis as { __WS_WORLD__?: unknown }).__WS_WORLD__;
  const s = GAME_STRINGS.mainMenu;
  const dev = mode().developer;
  // E7.5 prep: a build stamped with a world (`__WS_WORLD__`, as clientWorker.ts reads it) offers the Connection doctor on its title
  const online = (globalThis as { __WS_WORLD__?: unknown }).__WS_WORLD__ !== undefined;

  const root = document.createElement('div');
  root.className = 'ws-title-stack';
  const main = document.createElement('div');
  main.className = 'ws-main';
  main.innerHTML = `
    <div class="ws-main-hero"></div>
    <div class="ws-main-head"><div class="ws-main-logo">${s.logo}</div></div>
    <div class="ws-main-foot">
      <div class="ws-main-cards${grid ? '' : ' one'}" role="group" aria-label="${s.label}">
        <button class="ws-main-card ws-main-select" type="button"><span class="ws-main-icon">${CARDS_ICON}</span><b>${s.shardSelect}</b></button>
        ${grid || world !== undefined ? `<button class="ws-main-card ws-main-grid" type="button"${grid ? '' : ' hidden'}><span class="ws-main-icon">${GRID_ICON}</span><b>${s.infinite}</b> <i class="ws-main-card-exp">${s.experimental}</i></button>` : ''}
      </div>
      <div class="ws-main-row">
        <button class="ws-main-settings" type="button">${s.settings}</button>
        <button class="ws-main-dev${dev ? ' on' : ''}" type="button" role="switch" aria-checked="${dev}" aria-label="${s.developerLabel}"><i class="ws-main-dev-track" aria-hidden="true"></i>${s.developer}</button>
      </div>
      ${online ? `<div class="ws-main-row"><button class="ws-main-settings ws-main-doctor" type="button"><i class="ws-main-doctor-dot" aria-hidden="true"></i>${s.checkConnection}</button></div>` : ''}
    </div>`;
  const hero = required(main, '.ws-main-hero', HTMLElement);
  hero.style.setProperty('--ws-hero-landscape', `url('${MAIN_MENU_HERO}')`);
  hero.style.setProperty('--ws-hero-square', `url('${MAIN_MENU_SQUARE_HERO}')`);
  if (notice !== undefined && notice !== '') {
    const line = document.createElement('div');
    line.className = 'ws-main-notice';
    line.setAttribute('role', 'status');
    line.textContent = notice;
    required(main, '.ws-main-head', HTMLElement).append(line);
  }
  // MG4: while the idle title reads Low Power Mode as likely (boot/lowPower.ts, a second of rAF after two on screen), a phone
  // says so under the logo; the reading lands after the title shows, and goes when Low Power does, so it is re-read each second
  if (phone) {
    const power = document.createElement('div');
    power.className = 'ws-main-notice ws-main-power'; power.setAttribute('role', 'status'); power.textContent = LOW_POWER_BANNER;
    const paint = (): void => { power.hidden = !lowPowerOn(); };
    paint(); owner.interval(1000, paint);
    required(main, '.ws-main-head', HTMLElement).append(power);
  }
  // SF60 / G214 (Jake: B, a slim banner under the logo): Developer on and the day's lines; folded it is one line
  const banner = buildWhatsNewBanner({ news: whatsNew, developer: mode().developer, onTap: deck.onTap,
    ...(whatsNewStore === undefined ? {} : { store: whatsNewStore }) });
  if (banner !== null) required(main, '.ws-main-logo', HTMLElement).after(banner.root);
  // G106 (Jake: "A Carousel restyled"): SHARD SELECT is today's deck, same path and behaviour (G64), restyled to the menu:
  // BACK and the SHARD SELECT title on top, the crossroads hero dimmed behind, one big card, a thumbnail strip for the dots
  // (DEVELOPER tags, a COMING SOON lock) and a wide ENTER WORLD (src/client/game/mainMenu.css `.ws-menu-carousel`)
  deck.root.classList.add('ws-menu-carousel');
  const bar = document.createElement('div');
  bar.className = 'ws-menu-bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'ws-menu-back';
  back.textContent = s.back;
  const title = document.createElement('div');
  title.className = 'ws-menu-title';
  title.textContent = s.shardSelect;
  bar.append(back, title);
  deck.root.querySelector('.ws-menu-head')?.prepend(bar);
  root.append(deck.root, main);

  const selectCard = required(main, '.ws-main-select', HTMLButtonElement);
  const show = (next: MainMenuScreen): void => {
    screen = next;
    if (next === 'select') firstEntry = null; // MG5: a first PLAY that never got there is not this entry's
    root.dataset['screen'] = next;
    main.classList.toggle('hide', next !== 'main');
    deck.root.classList.toggle('hide', next !== 'select');
    main.inert = next !== 'main';
    deck.root.inert = next !== 'select';
    if (next === 'main') selectCard.focus({ preventScroll: true });
  };
  // MOBILE-GRAPHICS MG5: a phone's first PLAY (no `firstPlayDone` mark on the device) skips SHARD SELECT for the deck's first
  // playable card (Driftwood), where the first-play card waits (firstPlay.ts); every later PLAY, and every desktop one, opens
  // SHARD SELECT as before
  // The deck's own entry decides (its admission rules: a draft, a locked or unavailable card enters nothing); when it enters
  // nothing, SHARD SELECT opens as usual
  // MMO-PLAN MP2.4 (Jake, 2026-11-11: "Ask the user for their name… after they hit play but before we pop them into the world"):
  // a device's first PLAY (or INFINITE WILDSHARD) asks for the Name once, then goes on; every later one goes straight through
  let naming = false;
  const named = async (next: () => void): Promise<void> => {
    if (naming) return;
    if (!nameAskDue()) { next(); return; }
    naming = true;
    let answered = false;
    try { answered = await askNameOnce(owner, { parent: document.body }); } finally { naming = false; }
    if (answered && !owner.disposed) next();
  };
  const enterPlay = (): void => {
    if (phone && !firstPlayDone()) {
      deck.select(0, false);
      const entered = deck.activate();
      if (entered !== null) { firstEntry = startFirstPlay(entered.slug) ? entered : null; return; }
    }
    show('select'); deck.start();
  };
  const play = (): void => { void named(enterPlay); };
  deck.onTap(selectCard, play);
  const gridCard = main.querySelector('.ws-main-grid');
  if (gridCard instanceof HTMLButtonElement) deck.onTap(gridCard, () => { if (gridEntryShown(mode(), undefined, hosted)) void named(() => { dropFirstPlay(); onGrid(); leaveTitle(); }); });
  if (!grid && world !== undefined && gridCard instanceof HTMLButtonElement) {
    void (async (): Promise<void> => {
      if (!await worldHosted(world) || owner.disposed) return;
      hosted = true; gridCard.hidden = false; main.querySelector('.ws-main-cards')?.classList.remove('one');
    })();
  }
  // S2: only the player's last product, after the title paints; a first visit reads nothing. This is verified
  // disk prefetch, never world construction or a hidden offline-size scan. It shows nothing (QB2).
  let started = false;
  const startPrefetch = (): void => {
    if (started || opts.active !== null) return;
    started = true;
    owner.raf(() => {
      const choice = titlePrefetchChoice(saves), selectedMode = gridMode(mode().devserver, mode());
      const target = titlePrefetchTarget(choice.read(), titleManifests(), mode().developer);
      if (target === undefined) return;
      const load = async (): Promise<void> => {
        const {startTitlePrefetch} = await import('./grid/prefetch');
        if (owner.disposed || leavingTitle) return;
        const run = startTitlePrefetch(target, choice.flow(), `${Number(selectedMode.developer)}${Number(selectedMode.devserver)}${Number(selectedMode.nineDragon)}`);
        if (run === null) return;
        stopReadAhead = run.stop;
        owner.onDispose(run.stop);
        owner.listen(window, 'beforeunload', leaveTitle);
        // QB2 (Jake 13:41, "what the hell's preparing world?"): the read-ahead runs silently; no status line on the title
        // or in SHARD SELECT
      };
      void load().catch(() => undefined); // Optional read-ahead never refuses a title tap.
    });
  };
  deck.onTap(required(main, '.ws-main-settings', HTMLButtonElement), () => { opts.onSettings(); });
  // E7.5 prep (Jake, 2026-11-09): the title opens the Connection doctor's own page, past the service worker (`sw=0`). The title
  // holds no session and no loading report, so this is the plain navigation errorScreen.ts's openDoctorPage makes in play.
  const doctor = main.querySelector('.ws-main-doctor');
  if (doctor instanceof HTMLButtonElement) deck.onTap(doctor, () => { leaveTitle(); location.assign('/doctor/?sw=0&from=title'); });
  // E483 (Jake: "a better dev toggle … without having to go to the settings page"; E140's ask): the same live switch as
  // Settings ▸ Developer. Both title paths rebuild on the change (StartTitle / HUD `onDev`) on this screen, so the menu, the
  // INFINITE WILDSHARD card and SHARD SELECT's locked cards follow it at once.
  deck.onTap(required(main, '.ws-main-dev', HTMLButtonElement), () => { setDev(!dev); });
  deck.onTap(back, () => { show('main'); });
  show(first ?? screen);

  return {
    root, cards: deck.cards,
    get index() { return deck.index; },
    get screen() { return screen; },
    show,
    // the HUD's arrow keys move the deck; on the main menu they wait for SHARD SELECT
    select: (i, smooth) => { deck.select(i, smooth); },
    // the HUD's confirm / any key: the main menu's first card opens the deck, the deck enters its card
    activate: () => { if (screen === 'main') play(); else deck.activate(); },
    start: () => { deck.start(); startPrefetch(); if (screen === 'main') selectCard.focus({ preventScroll: true }); },
    dispose: () => { owner.dispose(); deck.dispose(); },
  };
}

/**
 * The cold title's Infinite Wildshard wiring (SF21a), one call for the composition root (src/client/app/entry.ts):
 *   - a stale one-shot intent is consumed here, so nothing but a new tap boots the grid (R3-C5);
 *   - when the previous page (the grid, or any standalone world by name, QB6) ended unexpectedly (iOS's memory kill),
 *     the title only adds one line.
 */
export interface GridTitle { readonly onGrid: () => void; readonly note: string; readonly screen?: MainMenuScreen }
/** Return the installed title action and note for the grid entry. */
export function installGridTitle(): GridTitle {
  dropGridIntent();
  const end = lastEnd();
  const loop = gridRecoveryLoop();
  // QB6: a standalone world's unexpected end gets the same one line, by the world's name
  const world = end.kind === 'unexpected' && end.mode !== 'grid' ? end.slug : '';
  const name = world.length === 0 ? '' : findTitleManifest(world)?.name ?? world;
  return { onGrid: enterGrid, note: loop || (end.kind === 'unexpected' && end.mode === 'grid') ? GAME_STRINGS.grid.ended : name !== '' ? GAME_STRINGS.grid.shardEnded(name) : '',
    ...(loop ? { screen: 'select' } : {}) };
}
