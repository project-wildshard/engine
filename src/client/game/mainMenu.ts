/**
 * The Wildshard main menu (MAIN-SCREEN, J387 / J399 board B, full-bleed; was SHARD-PLATFORM SF21a's G79 / G88 two cards): the
 * crossroads hero over the whole screen, framed wide enough on a phone that every zone of the grid shows, the WILDSHARD logo,
 * one loud ENTER THE MMO (the grid's entry, `onGrid`, for every player: Developer no longer gates it) and a quieter ZONE SELECT
 * that opens the deck (src/client/game/titleDeck.ts), then SETTINGS and the DEV switch. The deck sits under the menu, laid out
 * (so its carousel centres), and its BACK comes back.
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
import { openSignIn, saveFile, takeLink, titleLogin, titleSignedIn, type AccountPorts } from '@wildshard/engine/ui/signInCard';
import { deviceIdentity } from '@wildshard/engine/net/identity';
import { appIdentity } from '@wildshard/engine/app/identity';
import { saveEnvironment } from '@wildshard/engine/saves/environment';
import { engineString } from '@wildshard/engine/strings';
import { lastEnd, type LastEnd } from '@wildshard/engine/boot/lastEnd';
import { setDev } from '@wildshard/engine/core/devMode';
import { buildTitleDeck, titleCards, type TitleDeck, type TitleDeckOptions } from './titleDeck';
import { menuMode, gridMode } from './grid/menu';
import { dropGridIntent, enterGrid, gridRecoveryLoop } from './grid/pageEntry';
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
/** PZ19: the shell's ~30 kB first cuts of both heroes; the menu layers the full image over its first cut, so the art never
 *  blanks while the full image arrives, and the full image is fetched only once the title is up. */
const FIRST_HERO: string = titleAssetURL('/assets/title/main-crossroads-landscape-first.jpg');
const FIRST_SQUARE_HERO: string = titleAssetURL('/assets/title/main-crossroads-square-first.jpg');

const CARDS_ICON = '<svg viewBox="0 0 64 48" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="6" y="11" width="18" height="27" rx="2" transform="rotate(-16 15 24)"/><rect x="40" y="11" width="18" height="27" rx="2" transform="rotate(16 49 24)"/><rect x="22" y="4" width="20" height="31" rx="2" fill="rgba(6,10,18,0.85)"/></g></svg>';

/** The two title-menu destinations. */
export type MainMenuScreen = 'main' | 'select';
/** the screen this page's title is on: a rebuild (Developer flipped in Settings) comes back to it */
let screen: MainMenuScreen = 'main';

/** Caller-owned title deck and navigation options. */
export interface TitleMenuOptions extends Omit<TitleDeckOptions, 'cards'> {
  /** the deck's cards (default: `titleCards()`, Developer read live) */
  readonly cards?: TitleDeckOptions['cards'];
  /** ENTER THE MMO's tap: boots the grid from its one-shot intent (src/client/game/grid/pageEntry.ts `enterGrid`) */
  readonly onGrid: () => void;
  /** which screen to open on (default: the one this page was last on, the main menu at first) */
  readonly screen?: MainMenuScreen;
  /** A world already preparing owns its own mandatory reads; do not start optional title read-ahead beside them. */
  readonly readAhead?: false;
  /** Retain the already painted small hero while mandatory world bytes use the connection. */
  readonly fullHero?: false;
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
  /** Let an open first-play name prompt complete before replacing this view. */
  readonly whenIdle: () => Promise<void>;
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
  let viewScreen = first ?? screen;
  // leaving the title for a world resets it: pause ▸ EXIT TO MAIN opens on the main menu again
  // MG4 / MG5: a phone, by the rule the tier uses (core/tier.ts), read here without the tier's render tables (the title's graph)
  const phone = mobileDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  const deck = buildTitleDeck({ ...deckOpts, cards,
    // MG5: a phone with no first-play mark arms its first play for the card the player picked from the deck (the intent is a
    // session save, so it survives the hand-over); any other entry drops a first play armed and never reached
    onEnter: (card) => { if (!(phone && !firstPlayDone() && startFirstPlay(card.slug))) dropFirstPlay(); leaveTitle(); screen = 'main'; deckOpts.onEnter(card); },
    onExplore: (card) => { dropFirstPlay(); leaveTitle(); screen = 'main'; deckOpts.onExplore(card); } });
  const s = GAME_STRINGS.mainMenu;
  const dev = mode().developer;

  const root = document.createElement('div');
  root.className = 'ws-title-stack';
  const main = document.createElement('div');
  main.className = 'ws-main';
  main.innerHTML = `
    <div class="ws-main-hero"></div>
    <div class="ws-main-head"><div class="ws-main-logo">${s.logo}</div></div>
    <div class="ws-main-foot">
      <div class="ws-main-cards" role="group" aria-label="${s.label}">
        <button class="ws-main-card ws-main-mmo ws-main-grid" type="button"><b>${s.enterMmo}</b><small><i class="ws-main-live" aria-hidden="true"></i>${s.enterMmoLine}</small></button>
        <button class="ws-main-card ws-main-select" type="button"><span class="ws-main-icon">${CARDS_ICON}</span><b>${s.zoneSelect}</b></button>
      </div>
      <div class="ws-main-row">
        <button class="ws-main-settings ws-main-signin" type="button" data-signed-in="${String(titleSignedIn())}">${engineString(titleSignedIn() ? 's_signin_account' : 's_signin_open')}</button>
        <button class="ws-main-settings" type="button">${s.settings}</button>
        <button class="ws-main-dev${dev ? ' on' : ''}" type="button" role="switch" aria-checked="${dev}" aria-label="${s.developerLabel}"><i class="ws-main-dev-track" aria-hidden="true"></i>${s.developer}</button>
      </div>
    </div>`;
  const hero = required(main, '.ws-main-hero', HTMLElement);
  hero.style.setProperty('--ws-hero-landscape', `url('${opts.fullHero === false ? FIRST_HERO : MAIN_MENU_HERO}'), url('${FIRST_HERO}')`);
  hero.style.setProperty('--ws-hero-square', `url('${opts.fullHero === false ? FIRST_SQUARE_HERO : MAIN_MENU_SQUARE_HERO}'), url('${FIRST_SQUARE_HERO}')`);
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
  // G106 (Jake: "A Carousel restyled"): ZONE SELECT (J387, was SHARD SELECT) is today's deck, same path and behaviour (G64), restyled to the menu:
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
  title.textContent = s.zoneSelect;
  bar.append(back, title);
  deck.root.querySelector('.ws-menu-head')?.prepend(bar);
  root.append(deck.root, main);

  const selectCard = required(main, '.ws-main-select', HTMLButtonElement), mmoCard = required(main, '.ws-main-mmo', HTMLButtonElement);
  const show = (next: MainMenuScreen): void => {
    screen = next; viewScreen = next;
    root.dataset['screen'] = next;
    main.classList.toggle('hide', next !== 'main');
    deck.root.classList.toggle('hide', next !== 'select');
    main.inert = next !== 'main';
    deck.root.inert = next !== 'select';
    if (next === 'main') mmoCard.focus({ preventScroll: true });
  };
  // SHARD SELECT always opens the deck, and nothing loads until a card is picked (Jake, 2026-11-12: "That shard select insta
  // loads driftwood bug is still here"). MOBILE-GRAPHICS MG5 used to skip the deck on a phone's first PLAY for card 0
  // (Driftwood) until the first-play card's DONE marked the device; a phone that never pressed DONE (a load that stalled, a
  // player who backed out or never noticed the card) skipped it on every tap. A phone with no mark now opens the deck on card 0, and the
  // first-play card is armed for whichever card the player enters (onEnter above)
  // MMO-PLAN MP2.4 (Jake, 2026-11-11: "Ask the user for their name… after they hit play but before we pop them into the world"):
  // a device's first PLAY (or ENTER THE MMO) asks for the Name once, then goes on; every later one goes straight through
  let naming = false;
  let nameIdle = Promise.resolve();
  const named = async (next: () => void): Promise<void> => {
    if (naming) return;
    if (!nameAskDue()) { next(); return; }
    naming = true;
    let finishName: () => void = () => undefined;
    nameIdle = new Promise<void>(resolve => { finishName = resolve; });
    let answered = false;
    try { answered = await askNameOnce(owner, { parent: document.body }); } finally { naming = false; finishName(); }
    if (answered && !owner.disposed) next();
  };
  const enterPlay = (): void => {
    if (phone && !firstPlayDone()) deck.select(0, false);
    show('select'); deck.start();
  };
  const play = (): void => { void named(enterPlay); };
  deck.onTap(selectCard, play);
  const enterMmo = (): void => { void named(() => { dropFirstPlay(); onGrid(); leaveTitle(); }); };
  deck.onTap(mmoCard, enterMmo);
  // S2: only the player's last product, after the title paints; a first visit reads nothing. This is verified
  // disk prefetch, never world construction or a hidden offline-size scan. It shows nothing (QB2).
  let started = false;
  const startPrefetch = (): void => {
    if (started || opts.active !== null || opts.readAhead === false) return;
    started = true;
    // OFFLINE OF5a: a title that stays 10 s asks the worker to hold this build's code, so an update seen only here still
    // launches offline; the worker does it only on a device that held an older build (a first visit reads nothing, S2)
    owner.timeout(10_000, () => { if (!leavingTitle) { document.documentElement.dataset['wsTitleSettled'] = '1'; document.dispatchEvent(new Event('ws:title-settled')); } });
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
  deck.onTap(required(main, '.ws-main-settings:not(.ws-main-signin)', HTMLButtonElement), () => { opts.onSettings(); });
  // MMO-PLAN MP2.2e2: SIGN IN opens the sign-in card; a mailed link (`#login=…`) back on this page is spent here and opens it on
  // its answer. The button says ACCOUNT once signed in.
  const signIn = required(main, '.ws-main-signin', HTMLButtonElement);
  const relabel = (): void => { const yes = titleSignedIn(); signIn.textContent = engineString(yes ? 's_signin_account' : 's_signin_open'); signIn.dataset['signedIn'] = String(yes); };
  // MMO-PLAN MP2.5c: ACCOUNT's Download my data and Delete account reach the world's door (read from the signed release file on the
  // tap, `accountDoor.ts`) with this device's join ticket; the device id is the one the online join sends.
  const account: AccountPorts = {
    door: async () => (await import('./accountDoor')).worldDoor(),
    device: () => { const page = saveEnvironment().storage('shard'); return page === null ? `device:${crypto.randomUUID()}` : deviceIdentity(page, appIdentity().savePrefix).player; },
    save: saveFile,
  };
  deck.onTap(signIn, () => { void openSignIn(owner, { parent: document.body, changed: relabel, account }); });
  const login = titleLogin();
  const landed = async (ports: NonNullable<typeof login>): Promise<void> => {
    const note = await takeLink(ports);
    if (note === undefined || owner.disposed) return;
    relabel(); await openSignIn(owner, { parent: document.body, changed: relabel, note, account });
  };
  if (login !== undefined) void landed(login);
  // MS2 (J399, board B): CHECK CONNECTION left the main screen; Settings ▸ System's Connection doctor row opens the same page
  // E483 (Jake: "a better dev toggle … without having to go to the settings page"; E140's ask): the same live switch as
  // Settings ▸ Developer. Both title paths rebuild on the change (StartTitle / HUD `onDev`) on this screen, so the menu, the
  // ZONE SELECT's locked cards follow it at once.
  deck.onTap(required(main, '.ws-main-dev', HTMLButtonElement), () => { setDev(!dev); });
  deck.onTap(back, () => { show('main'); });
  show(viewScreen);

  return {
    root, cards: deck.cards,
    get index() { return deck.index; },
    get screen() { return viewScreen; },
    show,
    whenIdle: () => nameIdle,
    // the HUD's arrow keys move the deck; on the main menu they wait for ZONE SELECT
    select: (i, smooth) => { deck.select(i, smooth); },
    // the HUD's confirm / any key (inputContexts `confirm: ['*']`): the main menu opens ZONE SELECT, which loads nothing (a stray
    // key never starts the MMO's download); the deck enters its card. A focused ENTER THE MMO takes Enter / Space as its own click
    activate: () => { if (viewScreen === 'main') play(); else deck.activate(); },
    start: () => { deck.start(); startPrefetch(); if (viewScreen === 'main') mmoCard.focus({ preventScroll: true }); },
    dispose: () => { owner.dispose(); deck.dispose(); },
  };
}

/**
 * The cold title's ENTER THE MMO wiring (SF21a's grid entry), one call for the composition root (src/client/app/entry.ts):
 *   - a stale one-shot intent is consumed here, so nothing but a new tap boots the grid (R3-C5);
 *   - when the previous page (the grid, or any standalone world by name, QB6) ended unexpectedly (iOS's memory kill),
 *     the title only adds one line.
 */
export interface GridTitle { readonly onGrid: () => void; readonly note: string; readonly screen?: MainMenuScreen }
/** Return the installed title action and note for the grid entry. */
export function installGridTitle(options: { readonly preserveIntent?: boolean } = {}): GridTitle {
  if (options.preserveIntent !== true) dropGridIntent();
  const loop = gridRecoveryLoop();
  return { onGrid: enterGrid, note: endedNote(lastEnd(), loop), ...(loop ? { screen: 'select' } : {}) };
}

/** The title's one line about the previous page's unexpected end: the grid's, or a standalone world's by its name (QB6).
 *  OF14: the world's name wins over the grid's recovery loop, which a one-shard page's crash inside the grid's 10-minute
 *  recovery guard trips too (Signal Dunes' offline failure said "Infinite Wildshard ended unexpectedly last time"). */
export function endedNote(end: Pick<LastEnd, 'kind' | 'mode' | 'slug'>, loop: boolean, find: (slug: string) => { readonly name: string } | undefined = findTitleManifest): string {
  const world = end.kind === 'unexpected' && end.mode !== 'grid' ? end.slug : '';
  const name = world.length === 0 ? '' : find(world)?.name ?? world;
  if (name !== '') return GAME_STRINGS.grid.shardEnded(name);
  return loop || (end.kind === 'unexpected' && end.mode === 'grid') ? GAME_STRINGS.grid.ended : '';
}
