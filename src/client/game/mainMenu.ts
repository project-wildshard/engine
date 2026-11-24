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
import { lowPowerHolds } from '@wildshard/engine/core/graphicsMode';
import { askNameOnce, nameAskDue } from '@wildshard/engine/ui/namePrompt';
import { openSignIn, saveFile, takeLinkOutcome, titleLogin, titleSignedIn, type AccountPorts } from '@wildshard/engine/ui/signInCard';
import { engineString } from '@wildshard/engine/strings';
import { lastEnd, type LastEnd } from '@wildshard/engine/boot/lastEnd';
import { endPlay } from '@wildshard/engine/boot/endPlay';
import { setDev } from '@wildshard/engine/core/devMode';
import { buildTitleDeck, titleCards, type DeckTab, type TitleDeck, type TitleDeckOptions } from './titleDeck';
import { menuMode, gridMode } from './grid/menu';
import { dropGridIntent, enterGrid, gridRecoveryLoop } from './grid/pageEntry';
import { prefetchSeat } from './grid/seatAsk';
import { pageScope } from '@wildshard/engine/app/resources';
import { saves } from '@wildshard/engine/saves/runtime';
import { findTitleManifest, titleManifests } from './shard/titleList';
import { titlePrefetchChoice, titlePrefetchTarget } from './grid/titlePrefetchChoice';
import { armTitleHandover } from './titleHandover';

import { GAME_STRINGS } from '../../shared/game/strings';
import { WHATS_NEW, type WhatsNew } from './whatsNew';
import { buildWhatsNewBanner, type HiddenStore } from './whatsNewBanner';
import { offPlayerLists, type ZoneSelectDocument } from '@wildshard/engine/game/grid/zoneSelectRows';
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
/** ZS10: the Zone Select tab this page was last on; a rebuild (Developer flipped, the late room list) comes back to it */
let zoneTab = 'featured';

/** Caller-owned title deck and navigation options. */
export interface TitleMenuOptions extends Omit<TitleDeckOptions, 'cards'> {
  /** the deck's cards (default: `titleCards()`, Developer read live) */
  readonly cards?: TitleDeckOptions['cards'];
  /** Live or baked order. The title's own manifests still provide art and entry policy. */
  readonly zoneSelect?: ZoneSelectDocument | null;
  /** the home screen's SETTINGS (J458); the deck under ZONE SELECT has none (EXPLORE-MODE EX1, QA row 48) */
  readonly onSettings: () => void;
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
  /** Let an open first-play name prompt, and an entry the world gate holds, complete before replacing this view; a title that
   *  entered a world never settles (SB49) */
  readonly whenIdle: () => Promise<void>;
}

function required<T extends HTMLElement>(root: ParentNode, selector: string, type: new () => T): T {
  const found = root.querySelector(selector);
  if (!(found instanceof type)) throw new Error(`Main menu: missing ${selector}`);
  return found;
}

function orderTitleCards(cards: TitleDeck['cards'], served: readonly { readonly slug: string }[] | undefined): TitleDeck['cards'] {
  if (served === undefined) return cards;
  const bySlug = new Map(cards.map(card => [card.slug, card]));
  return served.flatMap(({ slug }) => {
    const card = bySlug.get(slug);
    if (card === undefined) return [];
    bySlug.delete(slug);
    return [card];
  });
}

/** ZS10 (J461, J469): Zone Select's tabs in the room list's orders, over the build's cards. FEATURED, the tab Zone Select opens
 *  on, is never empty: with no list (no baked or kept room list, pause ▸ EXIT TO MAIN) or none of its zones in this build it
 *  holds the build's cards. POPULAR and NEW may be empty. Developer mode adds ALL: the room list's every zone, then this
 *  build's cards it does not name (hidden ones too), laid out as a list. */
export function zoneTabs(cards: TitleDeck['cards'], served: ZoneSelectDocument | null | undefined, developer: boolean): DeckTab[] {
  const s = GAME_STRINGS.mainMenu.tabs;
  // No door answer (preview, solo, a standalone `?chunk=` boot): the build's own cards, hidden ones too, as before row 26. A
  // hidden shard booted by its route (cook-to-play's Brasscap Mesa) must stay the deck's card, or ENTER enters another shard.
  if (served === null || served === undefined) return [{ id: 'featured', label: s.featured, cards }, { id: 'popular', label: s.popular, cards },
    { id: 'new', label: s.new, cards }, ...developer ? [{ id: 'all' as const, label: s.all, cards, list: true as const }] : []];
  // QA 11-23-b row 26 (J453): a hidden or test shard is on no player's tab, whatever an older door or a kept list serves and
  // whether or not the grid places it; Developer mode's ALL still lists it.
  const hidden = new Set([...served.all ?? [], ...served.featured ?? [], ...served.popular ?? [], ...served.new ?? []]
    .filter(card => offPlayerLists(card)).map(card => card.slug));
  const players = cards.filter(card => !hidden.has(card.slug) && card.badge !== 'Developer only' && !offPlayerLists(card));
  const featured = orderTitleCards(players, served.featured);
  const tabs: DeckTab[] = [
    { id: 'featured', label: s.featured, cards: featured.length > 0 ? featured : players.length > 0 ? players : cards },
    { id: 'popular', label: s.popular, cards: orderTitleCards(players, served.popular) },
    { id: 'new', label: s.new, cards: orderTitleCards(players, served.new) },
  ];
  if (developer) {
    const all = orderTitleCards(cards, served.all), named = new Set(all.map(card => card.slug));
    tabs.push({ id: 'all', label: s.all, cards: [...all, ...cards.filter(card => !named.has(card.slug))], list: true });
  }
  return tabs;
}

/** Build the shared title menu from its supplied deck and callbacks. */
export function buildTitleMenu(opts: TitleMenuOptions): TitleMenu {
  const owner = pageScope.child('title-prefetch');
  let leavingTitle = false;
  let stopReadAhead: (() => void) | undefined;
  // QA 11-23 row 8 (Jake, 11-23: an update boot is "frozen"): from the tap until the next document paints the page shows
  // motion. Leaving waits on the network (a first visit's worker install, an old worker's network-first wait for a newer
  // build's page), so a bar sweeps along the top until the page goes (mainMenu.css .ws-main-leaving).
  let leavingHost: HTMLElement | null = null; // the title's full-screen layer, once built below
  const leaveTitle = (): void => {
    leavingTitle = true; stopReadAhead?.();
    if (leavingHost === null || leavingHost.querySelector('.ws-main-leaving') !== null) return;
    const bar = document.createElement('div'); bar.className = 'ws-main-leaving'; bar.setAttribute('aria-hidden', 'true');
    leavingHost.append(bar); // .ws-main is the title's full-screen layer (its size containment holds the fixed bar)
  };
  const mode = opts.mode ?? menuMode;
  const { notice, onGrid, screen: first, zoneSelect, whatsNew = WHATS_NEW, whatsNewStore, ...deckOpts } = opts;
  const dev = mode().developer;
  const tabs = zoneTabs(opts.cards ?? titleCards(dev), zoneSelect, dev);
  let viewScreen = first ?? screen;
  // leaving the title for a world resets it: pause ▸ EXIT TO MAIN opens on the main menu again
  // MG4 / MG5: a phone, by the rule the tier uses (core/tier.ts), read here without the tier's render tables (the title's graph)
  const phone = mobileDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  // J468 (Jake's look): a full-bleed swipe, 4 mini heroes in a sliding window, the stripe pager and "1 / 8"
  const deck = buildTitleDeck({ ...deckOpts, cards: tabs[0]?.cards ?? [], tabs, tab: zoneTab, strip: 4, onTab: (id) => { zoneTab = id; },
    // MG5: a phone with no first-play mark arms its first play for the card the player picked from the deck (the intent is a
    // session save, so it survives the hand-over); any other entry drops a first play armed and never reached
    onEnter: (card) => { if (!(phone && !firstPlayDone() && startFirstPlay(card.slug))) dropFirstPlay(); leaveTitle(); screen = 'main'; deckOpts.onEnter(card); } });
  const s = GAME_STRINGS.mainMenu;

  const root = document.createElement('div');
  root.className = 'ws-title-stack';
  const main = document.createElement('div');
  leavingHost = main;
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
    const paint = (): void => { power.hidden = !lowPowerHolds(); };
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
  // ZS10 (J468, Jake's look; board https://claude.ai/artifact/FDzM6sgRKvnRnx9xCcV2c9, 04 with 09's mini heroes): the tabs are the
  // header beside a square BACK, the zone's hero fills the screen, its name and one line over the hero's foot
  deck.root.classList.add('ws-menu-carousel', 'ws-menu-swipe');
  const bar = document.createElement('div');
  bar.className = 'ws-menu-bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'ws-menu-back';
  back.textContent = s.back;
  back.setAttribute('aria-label', s.back);
  if (deck.tabBar === null) {
    const title = document.createElement('div');
    title.className = 'ws-menu-title';
    title.textContent = s.zoneSelect;
    bar.append(back, title);
  } else bar.append(back, deck.tabBar);
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
  // FM4 9b/10b: the title's gate (a world build's) may hold the MMO's entry too, until the world is back
  // SB37b: while the gate reads the world (seconds on a slow phone) the tap is in flight, so the idle title hand-over waits
  let entering = false;
  let mmoIdle = Promise.resolve();
  const enterMmo = (): void => { void named(() => {
    const go = (): void => { dropFirstPlay(); onGrid(); leaveTitle(); };
    if (deckOpts.gate === undefined) { go(); return; }
    entering = true;
    // QA 11-23 row 8: the gate asks the world (its code and a read, seconds on a phone); the tapped button sweeps meanwhile
    mmoCard.setAttribute('aria-busy', 'true');
    // J501: a gate that throws never eats the tap: the title comes back with the modal, its code and Retry
    const gate = deckOpts.gate;
    mmoIdle = (async (): Promise<void> => {
      try { await gate(go); }
      catch (error) { endPlay({ code: 'ENTRY-GATE', what: 'Couldn\'t enter the MMO', why: 'Enter MMO couldn\'t ask the world whether it is up.', error, retry: true }); }
      finally {
        entering = false;
        if (!leavingTitle) mmoCard.removeAttribute('aria-busy');
      }
    })();
  }); };
  // SB49 (staging, "Navigation shell requires a live owner"): the late catalogue's refresh disposed this menu while the world gate
  // held ENTER ZONE, so the gate's go reached a dead deck. Idle is no name prompt, no held tap and no entry under way, all at once
  // (a named tap goes on to its entry); a title leaving for a world is never replaced.
  const whenIdle = async (): Promise<void> => {
    for (;;) {
      await nameIdle; await mmoIdle; await deck.whenIdle();
      if (!naming && !entering && !deck.busy()) break;
    }
    if (leavingTitle) await new Promise<never>(() => { /* never settles */ });
  };
  deck.onTap(mmoCard, enterMmo);
  // QA 11-23-b row 19: a world build asks the door where this player stands once the title paints, so ENTER THE MMO boots that zone
  // straight away (one loading screen, never home and then a move); a build with no world asks nothing
  owner.raf(() => { if (!leavingTitle && !owner.disposed) prefetchSeat(); });
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
  // tap, `accountDoor.ts`) with a five-minute confirm the API mints for the session (MP2.5e).
  const account: AccountPorts = {
    door: async () => (await import('./accountDoor')).worldDoor(),
    save: saveFile,
  };
  deck.onTap(signIn, () => { void openSignIn(owner, { parent: document.body, changed: relabel, account }); });
  const login = titleLogin();
  const landed = async (ports: NonNullable<typeof login>): Promise<void> => {
    // FM8b modes 28 and 29: a link the API refused, or couldn't take, opens the card on why
    const taken = await takeLinkOutcome(ports);
    if (taken === undefined || owner.disposed) return;
    relabel(); await openSignIn(owner, { parent: document.body, changed: relabel, note: taken.note, account, ...taken.failure === undefined ? {} : { failure: taken.failure } });
  };
  if (login !== undefined) void landed(login);
  // MS2 (J399, board B): CHECK CONNECTION left the main screen; Settings ▸ System's Connection doctor row opens the same page
  // E483 (Jake: "a better dev toggle … without having to go to the settings page"; E140's ask): the same live switch as
  // Settings ▸ Developer. Both title paths rebuild on the change (StartTitle / HUD `onDev`) on this screen, so the menu, the
  // ZONE SELECT's locked cards follow it at once.
  deck.onTap(required(main, '.ws-main-dev', HTMLButtonElement), () => { setDev(!dev); });
  deck.onTap(back, () => { show('main'); });
  show(viewScreen);
  // SB37b: a cold title gives way to the candidate once its worker activates, only while it sits idle on the main screen
  if (opts.active === null) armTitleHandover(owner, () => viewScreen === 'main' && !naming && !entering && !leavingTitle);

  return {
    root,
    get cards() { return deck.cards; },
    get index() { return deck.index; },
    get screen() { return viewScreen; },
    show,
    whenIdle,
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
