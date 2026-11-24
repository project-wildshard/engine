import { titleAssetURL } from './titleAssets';
import { pageScope } from '@wildshard/engine/app/resources';
import { isDev } from '@wildshard/engine/core/devMode';
import { capturePointer, followsTap, listenDom, listenTap } from '@wildshard/engine/input/dom';
import { beginNavigationShell } from '@wildshard/engine/boot/shell';
import { startEntryDownload } from './shardfile/entryTransport';
import { saves } from '@wildshard/engine/saves/runtime';
import { titlePrefetchChoice } from './grid/titlePrefetchChoice';
/**
 * The title screen's shard deck — ONE implementation for both ways in (E318, Jake: "lol wtf why do we have two title
 * screens, one only please"): the cold launch (src/client/engine/ui/StartTitle.ts, renderer-free, before any shard loads) and pause ▸
 * EXIT TO MAIN (src/client/engine/ui/HUD.ts `showIntro`, over the loaded shard) build the same deck from the same cards.
 *
 *   const deck = buildTitleDeck({ cards: titleCards(), onEnter })
 *   parent.append(deck.root); deck.start()                // after it is in the DOM: centre the selected card
 *   deck.select(i) · deck.index · deck.activate()          // the HUD's arrow keys / any key
 *   deck.dispose()                                          // its resize listeners, when the title goes away
 *
 * A horizontal carousel of shard cards over the selected card's hero art (portrait / landscape by the viewport), dots
 * under it and ENTER ZONE. A swipe steps one card; the centred card is the
 * selection. Hero art loads for the selected card only; a neighbour's warms when a swipe or a dot press starts toward it,
 * and the card's thumbnail fills the backdrop until its hero paints.
 *
 * SF21a (G79 / G88): the Wildshard main menu (src/client/game/mainMenu.ts) sits over this deck; its SHARD SELECT opens it, unchanged
 * (G58 / G64), and its INFINITE WILDSHARD boots the grid. What ENTER WORLD may enter is §3.3's table. A card whose shardfile
 * needs a newer client (G86, temporary) is dimmed, badged NEEDS UPGRADE and promises YOUR SAVE IS KEPT; a shard this session
 * could not load (G167) is dimmed the same way, badged UNAVAILABLE with its reason, and keeps the save too.
 *
 * Cards use the generated, node-safe manifests; world builders remain lazy.
 * test/title-deck.test.ts keeps each card's name, label (the def's `biome`), badge and art equal to its ShardManifest.
 */
import { titleManifests, type TitleManifest } from './shard/titleList';
import type { ShardSlug } from '../../shared/game/shard/slug';
import { DRAFT_TITLES, type DraftTitle } from './draftTitles';
import { readSummary, summaryView } from './summary';
import { GAME_STRINGS } from '../../shared/game/strings';
import { menuMode, selectEnters, type MenuMode } from './grid/menu';
import { pageShardRefusals, refusalReason, type ShardRefusal } from './grid/refusal';
import { playerHidden, selectTitleRows, titleStatus } from '../../shared/game/grid/catalogueSlot';
import { worldOpens } from './grid/oneWayIn';
import './summary.css';
import './upgrade.css';


export type TitleBadge = 'Early access' | 'Experimental' | 'Partial' | 'Developer only';

/* J313 (Jake, 2026-11-12 ~23:05 Cancún): a card's status is its catalogue placement's (`titleStatus`), so the catalogue decides
 * what Shard Select shows a player; `partial` is J313's PARTIAL label. With no catalogue installed a card keeps its shard's own
 * status. Open plots keep no card (`shardSelect: false`): a player reaches them by crossing the grid. */

/** one shard card. The standalone title art fields are swapped alongside the manifests: src/client/engine/boot/extras.ts points them at their in-memory copies */
export interface TitleCard {
  readonly slug: ShardSlug;
  readonly name: string;
  /** the one-line player blurb under the name (the def's `biome`; E318: no grid coordinates, no chunk size) */
  readonly label: string;
  badge?: TitleBadge;
  thumbnail: string;
  heroPortrait: string;
  heroLandscape: string;
  /** G86 (temporary): the shardfile format this shard was built for, when this client can no longer read it */
  upgrade?: { readonly built: number };
  /** G167: this session refused the shard (memory, safety, format or load): the dimmed UNAVAILABLE card with its reason */
  unavailable?: ShardRefusal;
  /** OFFLINE OF3: a world build whose world doesn't open this shard: the dimmed card reads "Not in this world yet", ENTER WORLD off */
  closed?: true;
}

/** Which shards need an upgrade before this client can enter them (G86): the format version each was built for. Every
 *  built-in shard reads at the current format today, so the default is none; the shardfile loader's cached-product
 *  admission (src/client/game/shardfile/folder.ts, previous versions) is where an outside author's older shard will report one. */
export type UpgradeNeeded = (slug: string) => number | null;
const noUpgrades: UpgradeNeeded = () => null;
/** Which shards this session refused (G167; `src/client/game/grid/refusal.ts`), default: the page's session record. */
export type RefusedShard = (slug: string) => ShardRefusal | null;
const sessionRefusals: RefusedShard = (slug) => pageShardRefusals().read(slug);
/** Which shards this build's world opens (OF3), default: the build's world stamp and the device's kept world word. */
export type OpensShard = (slug: string) => boolean;
const buildWorld = (): OpensShard => worldOpens((globalThis as { __WS_WORLD__?: unknown }).__WS_WORLD__);

/** Developer mode reveals hidden levels after every player-facing card. */
export function titleCards(showHidden: boolean = isDev(), upgradeNeeded: UpgradeNeeded = noUpgrades, refused: RefusedShard = sessionRefusals, opens: OpensShard = buildWorld()): readonly TitleCard[] {
  const manifests = selectTitleRows(titleManifests(), showHidden);
  return manifests.map((m): TitleCard => titleCard(m, upgradeNeeded, refused, opens));
}

/** One shard's card, as Shard Select draws it; also the `/slug/<slug>` page's one card (SA36), which a shard with no Shard
 *  Select card (an open plot, an auto-placed shard) still gets. */
export function titleCard(m: TitleManifest, upgradeNeeded: UpgradeNeeded = noUpgrades, refused: RefusedShard = sessionRefusals, opens: OpensShard = buildWorld()): TitleCard {
  const card: TitleCard = {
    slug: m.slug, name: m.name, label: m.biome,
    thumbnail: m.card.thumb, heroPortrait: m.card.portrait, heroLandscape: m.card.landscape,
  };
  const status = titleStatus(m);
  if (status === 'earlyAccess') card.badge = 'Early access';
  if (status === 'experimental') card.badge = 'Experimental';
  if (status === 'partial') card.badge = 'Partial';
  if (playerHidden(m)) card.badge = 'Developer only';
  const built = upgradeNeeded(m.slug);
  if (built !== null) card.upgrade = { built };
  // OF3: a shard this world doesn't open never loads here, so no refusal of it is news
  if (built === null && !opens(m.slug)) card.closed = true;
  const refusal = built === null && card.closed === undefined ? refused(m.slug) : null; // G86's card already says NEEDS UPGRADE
  if (refusal !== null) card.unavailable = refusal;
  return card;
}

/** A deck entry: a shard's card, or a draft's COMING SOON card (WORLDCLAW-TOOLS W9, J19, J38): no world to enter, its
 * button opens the draft on the drafts site. Drafts follow the shards; the HUD's `deck.cards[deck.index]` stays shards only. */
interface DeckEntry {
  readonly slug: string;
  readonly name: string;
  readonly label: string;
  readonly badge?: TitleBadge | undefined;
  readonly upgrade?: { readonly built: number } | undefined;
  readonly unavailable?: ShardRefusal | undefined;
  readonly closed?: true | undefined;
  readonly thumbnail: string;
  readonly heroPortrait: string;
  readonly heroLandscape: string;
  readonly shard: TitleCard | null;
  readonly draft: DraftTitle | null;
}

const fromShard = (c: TitleCard): DeckEntry => ({ ...c, shard: c, draft: null });
const fromDraft = (d: DraftTitle): DeckEntry => ({
  slug: d.slug, name: d.name, label: d.line, thumbnail: d.thumb, heroPortrait: d.hero, heroLandscape: d.hero, shard: null, draft: d,
});

export interface TitleDeckOptions {
  readonly cards: readonly TitleCard[];
  /** the shard this page is running (its card is LOADED and selected first); null on the cold launch */
  readonly active: string | null;
  /** ENTER WORLD on a card */
  readonly onEnter: (card: TitleCard) => void;
  /** An optional observation of an enterable card's button press, before any world check. */
  readonly onPress?: (slug: string) => void;
  /** a line under the wordmark (the cold launch's "returned to shard select" after an interrupted boot) */
  readonly notice?: string;
  /** what the menu may show and enter (default: Settings ▸ Developer and the DEVSERVER build, read live) */
  readonly mode?: () => MenuMode;
  /** SA36: the `/slug/<slug>` page's one card. ENTER WORLD reads `play` over `hint`; `closed` (a slug with no grid cell)
   *  disables it and says why in the hint's place (Jake, grill Q16: the card and hero, Play disabled) */
  readonly single?: { readonly play: string; readonly hint: string; readonly closed?: string };
  /** runs on ENTER WORLD's tap before the entry (the slug page's first-play name ask, a world build's FM4 title hold); `go` enters the
   *  card tapped. A returned promise keeps ENTER WORLD busy until it settles. */
  readonly gate?: (go: () => void) => void | Promise<void>;
  /** ZS10 (J461): Zone Select's tabs, each its own cards in its own order; `cards` is ignored when they are given */
  readonly tabs?: readonly DeckTab[];
  /** the tab to open on (default: the first) */
  readonly tab?: string;
  /** a tab press, after the deck shows it (the menu keeps it across rebuilds) */
  readonly onTab?: (id: string) => void;
  /** J468 (Jake's look): the dots are a row of this many mini heroes, a window that slides with the selection
   *  ([0] 1 2 3, 0 [1] 2 3, 1 [2] 3 4), a pager of stripes with "1 / 8", and each card's line carries its feats; no summary */
  readonly strip?: number;
}

/** ZS10: one Zone Select tab. `list` (J469, Developer's ALL) lays it out as a hero over a list you scroll and tap */
export interface DeckTab {
  readonly id: string;
  readonly label: string;
  readonly cards: readonly TitleCard[];
  readonly list?: true;
}

export interface TitleDeck {
  readonly root: HTMLElement;
  /** the tab on show's cards */
  readonly cards: readonly TitleCard[];
  /** ZS10: the tab bar, for the menu to place beside BACK (null with no tabs) */
  readonly tabBar: HTMLElement | null;
  /** ZS10: the tab on show ('' with no tabs) */
  readonly tab: string;
  readonly showTab: (id: string) => void;
  readonly index: number;
  readonly select: (i: number, smooth?: boolean) => void;
  /** ENTER WORLD on the selected card */
  /** ENTER WORLD on the selected card: the card it started entering, or null (a draft, a locked card, an entry in flight) */
  readonly activate: () => TitleCard | null;
  /** centre the selected card: call once the deck is in the DOM (offsets need layout) */
  readonly start: () => void;
  readonly dispose: () => void;
  /** a tap on `el` runs `fn` (propagation stopped), owned by the deck's scope: the main menu over it wires its buttons here */
  readonly onTap: (el: HTMLElement, fn: () => void) => void;
  /** SB49: an ENTER WORLD the gate still holds, or an entry under way */
  readonly busy: () => boolean;
  /** SB49: settles once the deck is not busy; never, once an entry navigated (its shell is this deck's child: replacing the deck
   *  would cancel it) */
  readonly whenIdle: () => Promise<void>;
}

const SWORD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 3.5L9 14l1 1L20.5 4.5z M6.5 12.5l5 5 M8 14l-4.5 4.5 1 1L9 15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';

function required(root: ParentNode, selector: string): HTMLElement {
  const found = root.querySelector<HTMLElement>(selector);
  if (found === null) throw new Error(`Title deck: missing ${selector}`);
  return found;
}

/** a card the shipped game shows locked: a hidden shard or a `_` prototype (`titleCards` badges both Developer only). J313
 *  (Jake, 2026-11-12) opens EXPERIMENTAL and PARTIAL cards to every player, which replaces E386's "experimental enters only in
 *  Developer" */
const restricted = (card: DeckEntry): boolean => card.badge === 'Developer only';

/** ENTER WORLD for a card: Select a shard enters what §3.3's table allows in this mode (SF21a: shipped, Developer, DEVSERVER) */
function canEnter(card: DeckEntry, mode: MenuMode = menuMode()): boolean {
  if (card.draft || card.upgrade !== undefined || card.unavailable !== undefined || card.closed === true) return false;
  return selectEnters(card.slug, restricted(card), mode);
}

/** the tape over a card's image: a world that can't be entered reads COMING SOON, not EXPERIMENTAL (Jake, E386) */
function ribbonFor(card: DeckEntry, mode: MenuMode = menuMode()): string {
  if (card.draft) return mode.developer || mode.devserver ? GAME_STRINGS.drafts.ribbon(card.draft.stage) : GAME_STRINGS.drafts.comingSoon;
  if (card.upgrade !== undefined || card.unavailable !== undefined || card.closed === true) return ''; // G86 / G167 / OF3: the amber line says it, not a tape
  if (!canEnter(card, mode)) return 'Coming soon';
  return card.badge === 'Developer only' ? GAME_STRINGS.developer.ribbon : card.badge ?? '';
}

/** a dot's tag: the restyled SHARD SELECT (G106, src/client/game/mainMenu.css) draws each dot as a thumbnail with a DEVELOPER tag or a
 *  COMING SOON lock; today's plain dots ignore it */
function dotTag(card: DeckEntry, mode: MenuMode): 'soon' | 'developer' | '' {
  if (!canEnter(card, mode)) return 'soon';
  return restricted(card) ? 'developer' : '';
}

/** STAGING-BUGBASH SB11: a card ENTER WORLD enters never says "Coming soon" under its name. An open plot's own blurb is
 *  "Open plot · coming soon" (shard-open-plots' manifest), written for a plot with nothing on it yet. */
export function enterableLabel(label: string): string {
  return label.replace(/\s*·\s*coming soon\s*$/iu, '');
}

/** STAGING-BUGBASH SB11: the draft's world is carded as a shard, by its own slug or as an open plot of it */
function draftCarded(draft: DraftTitle, card: TitleCard): boolean {
  const tail = card.slug.split('-').slice(-draft.slug.split('-').length).join('-');
  return new Set([draft.slug]).has(tail);
}

function hintFor(card: DeckEntry, active: boolean, mode: MenuMode = menuMode()): string {
  if (card.draft) return mode.developer || mode.devserver ? card.draft.stageName : GAME_STRINGS.drafts.notPlayable;
  if (card.upgrade !== undefined || card.unavailable !== undefined) return GAME_STRINGS.upgrade.saveKept;
  if (!canEnter(card, mode)) return '';
  if (!active) return `Loads ${card.name}`;
  return card.badge === 'Early access' || card.badge === 'Experimental' || card.badge === 'Partial' ? card.badge : 'Play';
}

export function buildTitleDeck(opts: TitleDeckOptions): TitleDeck {
  const mode = opts.mode ?? menuMode;
  const scope = pageScope.child('title-deck');
  const onTap = (el: HTMLElement, fn: () => void): void => { listenTap(scope, el, fn); };
  const tabs = opts.tabs ?? [];
  let tab: DeckTab | undefined = tabs.find(t => t.id === opts.tab) ?? tabs[0];
  let cards: readonly TitleCard[] = tab?.cards ?? opts.cards;
  const strip = opts.strip;
  const root = document.createElement('div');
  root.className = 'ws-menu';
  // J468: the caption names the selected zone over the hero when a tab is a list (J469); the pager is the carousel's place
  const pager = strip === undefined ? '' : `<div class="ws-menu-pager"><span class="ws-menu-stripes" aria-hidden="true"></span><span class="ws-menu-count"></span></div>`;
  const caption = strip === undefined ? '' : `<div class="ws-menu-caption"><b></b><small></small></div>`;
  root.innerHTML = `
    <div class="ws-menu-hero"></div>
    <div class="ws-menu-head"><div class="ws-wordmark">Project <b>Wildshard</b></div>
</div>
    <div class="ws-menu-deck">${caption}
      <div class="ws-menu-cards"><div class="ws-menu-deck-track"></div></div>
      <div class="ws-menu-dots"></div>${pager}
      <div class="ws-menu-modes"><button class="ws-menu-mode ws-menu-play" type="button"><span class="ws-menu-mode-glyph">${SWORD}</span><b>${GAME_STRINGS.mainMenu.enterZone}</b><small></small></button></div>
    </div>`;
  const words = (tag: string, cls: string, text: string): HTMLElement => { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; };
  const cardTrack = required(root, '.ws-menu-deck-track'), dotTrack = required(root, '.ws-menu-dots');
  const stripeTrack = root.querySelector<HTMLElement>('.ws-menu-stripes'), count = root.querySelector<HTMLElement>('.ws-menu-count');
  const captionEl = root.querySelector<HTMLElement>('.ws-menu-caption');
  if (opts.notice) {
    const notice = document.createElement('div');
    notice.className = 'ws-menu-recovery';
    notice.setAttribute('role', 'status');
    notice.textContent = opts.notice;
    required(root, '.ws-menu-head').append(notice);
  }

  // J468: the strip's look carries each zone's feats on its line, so the old two-line summary goes
  const summary = document.createElement('div');
  summary.className = 'ws-title-summary';
  summary.setAttribute('aria-label', GAME_STRINGS.summary.label);
  const paintSummary = (card: DeckEntry): void => {
    const view = summaryView(readSummary(), titleManifests());
    const lines = new Map(view.lines.map((entry) => [entry.slug, entry] as const));
    const line = lines.get(card.slug);
    const selected = document.createElement('div'); selected.className = 'ws-title-summary-line';
    selected.textContent = GAME_STRINGS.summary.selected(card.name, line?.visited ? line.earned : null);
    const total = document.createElement('strong'); total.className = 'ws-title-summary-total';
    total.textContent = GAME_STRINGS.summary.total(view.earned);
    summary.replaceChildren(selected, total);
  };
  if (strip === undefined) required(root, '.ws-menu-dots').after(summary);
  const featsLine = (): ((slug: string) => string) => {
    const lines = new Map(summaryView(readSummary(), titleManifests()).lines.map((entry) => [entry.slug, entry] as const));
    return (slug) => GAME_STRINGS.summary.feats(lines.get(slug)?.earned ?? 0);
  };

  const hero = required(root, '.ws-menu-hero');
  const list = required(root, '.ws-menu-cards');
  const track = required(root, '.ws-menu-deck-track');
  const hint = required(root, '.ws-menu-play small');
  const play = root.querySelector<HTMLButtonElement>('.ws-menu-play');
  if (play === null) throw new Error('Title deck: missing ENTER ZONE');
  const portrait = (): boolean => innerWidth < innerHeight;
  const heroUrl = (c: DeckEntry): string => titleAssetURL(portrait() ? c.heroPortrait : c.heroLandscape);
  const listMode = (): boolean => tab?.list === true;

  // ZS10: a tab's cards fill the track and the dots; the deck's own listeners (swipe, ENTER ZONE) outlive a tab switch
  let entries: readonly DeckEntry[] = [];
  let activeIndex = -1;
  let cardEls: HTMLElement[] = [];
  let dots: HTMLElement[] = [];
  let stripes: HTMLElement[] = [];
  let cardScope = scope.child('title-deck-cards');
  let index = 0;
  // a swipe's trailing click must not re-select the card under the finger; -Infinity, not 0: a page under 400 ms old (a fast
  // preview load, a proof's first click) took every card click for a swipe's
  let swipedAt = -Infinity;
  const swipedJustNow = (): boolean => performance.now() - swipedAt <= 400;
  const fill = (): void => {
    cardScope.dispose(); cardScope = scope.child('title-deck-cards');
    // J313: a draft's card (Thin Ice, off the grid by J305) never loads, so only Developer sees it
    // SA36: the slug page holds exactly its one card, Developer or not
    // STAGING-BUGBASH SB11: a draft whose world is now a carded shard (Thin Ice's open plot, `open-plot-thin-ice`) has one card,
    // the shard's, never a second DRAFT MODE card beside it. ZS10: on Zone Select only the Developer's ALL list carries drafts
    const draftsHere = opts.single === undefined && (tab === undefined || tab.list === true) && (mode().developer || mode().devserver);
    const drafts = draftsHere ? DRAFT_TITLES.filter(d => !cards.some(c => draftCarded(d, c))) : [];
    entries = [...cards.map(fromShard), ...drafts.map(fromDraft)];
    activeIndex = entries.map((card): string => card.slug).indexOf(opts.active ?? '');
    const feats = strip === undefined ? null : featsLine();
    cardTrack.replaceChildren(); dotTrack.replaceChildren(); stripeTrack?.replaceChildren();
    if (entries.length === 0) cardTrack.append(words('p', 'ws-menu-empty', GAME_STRINGS.mainMenu.tabs.empty));
    entries.forEach((card, at) => {
      const active = at === activeIndex, button = document.createElement('button'); button.type = 'button'; button.dataset['i'] = String(at); button.dataset['slug'] = card.slug;
      const dimmed = card.upgrade !== undefined || card.unavailable !== undefined || card.closed === true, amber = card.unavailable !== undefined || card.closed === true;
      button.className = `ws-menu-card${active ? ' active' : ''}${dimmed ? ' ws-menu-card-upgrade' : ''}${amber ? ' ws-menu-card-unavailable' : ''}`;
      const image = document.createElement('span'); image.className = 'ws-menu-card-img'; image.style.backgroundImage = `url('${titleAssetURL(card.thumbnail)}')`;
      if (card.upgrade !== undefined) image.append(words('i', 'ws-menu-card-tag ws-menu-card-needs', GAME_STRINGS.upgrade.badge));
      else if (card.unavailable !== undefined) image.append(words('i', 'ws-menu-card-tag ws-menu-card-needs', GAME_STRINGS.unavailable.badge));
      // STAGING-BUGBASH SB17 (Jake's recommended pick): no LOAD / LOADED tag on the picture; it read as a button that does nothing.
      // ENTER WORLD's line under it says what a tap loads; the card keeps the fact for tests and styles
      const open = canEnter(card, mode());
      if (open && opts.single?.closed === undefined) button.dataset['enters'] = '1';
      // G238: the port badge, Developer on only (the public card is unchanged)
      const ribbon = ribbonFor(card, mode());
      const tone = !open ? '' : card.badge === 'Early access' ? ' ws-menu-card-ea' : card.badge === 'Partial' ? ' ws-menu-card-partial' : '';
      if (ribbon !== '') image.append(words('i', `ws-menu-card-exp${tone}`, ribbon));
      const line = open ? enterableLabel(card.label) : card.label;
      // J468: the strip's card line is the zone's one line and its feats ("We want to count feats still")
      const withFeats = feats !== null && open && card.shard !== null ? `${line} · ${feats(card.slug)}` : line;
      const sub = card.upgrade !== undefined ? GAME_STRINGS.upgrade.built(card.upgrade.built) : card.closed === true ? GAME_STRINGS.notInWorld.badge : card.unavailable !== undefined ? refusalReason(card.unavailable) : withFeats;
      button.append(image, words('b', '', card.name), words('small', amber ? 'ws-menu-card-reason' : '', sub)); cardTrack.append(button);
      const dot = document.createElement('i'); dot.dataset['i'] = String(at); dot.dataset['tag'] = dotTag(card, mode()); dot.style.setProperty('--thumb', `url('${titleAssetURL(card.thumbnail)}')`); dotTrack.append(dot);
      if (stripeTrack !== null) stripeTrack.append(document.createElement('i'));
    });
    cardEls = Array.from(root.querySelectorAll<HTMLElement>('.ws-menu-card'));
    dots = Array.from(root.querySelectorAll<HTMLElement>('.ws-menu-dots i'));
    stripes = stripeTrack === null ? [] : Array.from(stripeTrack.children).filter((e): e is HTMLElement => e instanceof HTMLElement);
    index = Math.max(0, activeIndex);
  };

  // STAGING-BUGBASH SB14: exactly one card is lit at any moment (menu.css dims the rest, never see-through)
  const light = (lit: number): void => { cardEls.forEach((e, n) => { e.classList.toggle('selected', n === lit); }); };
  // paginated track: one card per swipe, always centred — no native scroll, so it can't rest between cards. J469's list
  // tab scrolls natively and only lights its row
  const place = (i: number, extra = 0, animate = true): void => {
    const card = cardEls[i];
    if (card === undefined) return;
    if (listMode()) { track.style.transition = 'none'; track.style.transform = 'none'; light(i); return; }
    // layout reads first, then the one style write (no forced recalc per pointermove)
    const shift = list.clientWidth / 2 - (card.offsetLeft + card.offsetWidth / 2) + extra;
    // under a dragging finger the lit card is the one nearest the middle: the lit card hands over once, mid-drag
    let near = i;
    if (extra !== 0) {
      const middle = list.clientWidth / 2 - shift;
      let gap = Infinity;
      cardEls.forEach((e, n) => { const d = Math.abs(e.offsetLeft + e.offsetWidth / 2 - middle); if (d < gap) { gap = d; near = n; } });
    }
    track.style.transition = animate ? 'transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    track.style.transform = `translateX(${shift}px)`;
    light(near);
  };
  /** J468: the mini heroes are a window of `strip` that slides once the selection is past the second: [0] 1 2 3, 0 [1] 2 3,
   *  1 [2] 3 4. Every dot stays in the row (a proof script's `.ws-menu-dots i` nth click scrolls it into view); the row scrolls */
  const slideStrip = (smooth: boolean): void => {
    if (strip === undefined) return;
    const start = Math.max(0, Math.min(index - 1, entries.length - strip));
    const first = dots[start];
    if (first === undefined || typeof dotTrack.scrollTo !== 'function') return;
    dotTrack.scrollTo({ left: first.offsetLeft, behavior: smooth ? 'smooth' : 'instant' });
  };
  const apply = (smooth = true): void => {
    const c = entries[index];
    if (c === undefined) {
      hero.classList.remove('show'); hint.textContent = ''; play.disabled = true;
      if (count !== null) count.textContent = '';
      if (captionEl !== null) captionEl.hidden = true;
      return;
    }
    light(index);
    dots.forEach((d, i) => { d.classList.toggle('on', i === index); });
    stripes.forEach((s, i) => { s.classList.toggle('on', i === index); });
    if (count !== null) count.textContent = GAME_STRINGS.mainMenu.count(index + 1, entries.length);
    if (captionEl !== null) {
      captionEl.hidden = false;
      required(captionEl, 'b').textContent = c.name;
      required(captionEl, 'small').textContent = cardEls[index]?.querySelector('small')?.textContent ?? c.label;
    }
    slideStrip(smooth);
    // the card's own thumbnail (already on screen in the card) under the hero: until the hero's bytes arrive and decode
    // (a phone network, a busy page), the backdrop is the card's picture, never black (Jake's Pine Hollow, ab93dccfe)
    hero.style.backgroundImage = `url('${heroUrl(c)}'), url('${titleAssetURL(c.thumbnail)}')`;
    hero.classList.add('show');
    const open = canEnter(c, mode()), single = opts.single;
    hint.textContent = single?.closed ?? (single === undefined || !open ? hintFor(c, index === activeIndex, mode()) : single.hint);
    play.disabled = (!open && c.draft === null) || single?.closed !== undefined;
    required(play, 'b').textContent = c.draft ? (isDev() ? GAME_STRINGS.drafts.draftMode : GAME_STRINGS.drafts.followBuild) : c.upgrade !== undefined ? GAME_STRINGS.upgrade.badge : c.unavailable !== undefined ? GAME_STRINGS.unavailable.badge : c.closed === true ? GAME_STRINGS.notInWorld.badge : open ? single?.play ?? GAME_STRINGS.mainMenu.enterZone : 'Coming soon';
    if (strip === undefined) paintSummary(c);
  };
  const select = (raw: number, smooth = true): void => {
    const i = Math.max(0, Math.min(entries.length - 1, raw));
    place(i, 0, smooth);
    if (i !== index) { index = i; apply(smooth); }
  };
  /** the tab's cards and dots, wired in the tab's own scope */
  const bind = (): void => {
    // a click that only follows the title's SHARD SELECT tap lands where that tap was, not on a card or dot (QC2)
    cardEls.forEach((e, i) => { listenDom(cardScope, e, 'click', (ev) => { ev.stopPropagation(); if (!followsTap(ev) && i !== index && !swipedJustNow()) select(i); }); });
    // a swipe that starts on a mini hero steps the deck; its trailing click must not then select that mini hero
    dots.forEach((d, i) => { listenDom(cardScope, d, 'click', (ev) => { ev.stopPropagation(); if (!followsTap(ev) && !swipedJustNow()) select(i); }); });
    dots.forEach((d, i) => { listenDom(cardScope, d, 'pointerdown', () => { warm(i); }); });
  };
  // the card is entered through its shardfile, whose download starts first
  let entering = false;
  // SB49: a tap the gate holds, and an entry under way, keep the deck busy; the title's late catalogue refresh waits for both
  let gating = 0;
  const waiting: (() => void)[] = [];
  const busy = (): boolean => entering || gating > 0;
  const settle = (): void => { if (!busy()) for (const resolve of waiting.splice(0)) resolve(); };
  const enter = (c: DeckEntry): boolean => {
    if (entering) return false;
    if (c.shard === null || !canEnter(c, mode()) || opts.single?.closed !== undefined) return false;
    const shard = c.shard;
    entering = true;
    startEntryDownload(c.slug); titlePrefetchChoice(saves).remember(c.slug);
    const attempt = beginNavigationShell(c.name, scope, () => { opts.onEnter(shard); }, play);
    attempt.onDispose(() => { entering = false; settle(); });
    return true;
  };
  /** ENTER WORLD, or a key: the shard's one entry (its shardfile, G531 / LD5). The card it started entering, if any (MG5) */
  const activate = (at: number = index): TitleCard | null => {
    const c = entries[at];
    // A draft opens on the drafts site (J16, J19): FOLLOW THE BUILD shows its teaser, DRAFT MODE its pages (Developer on there).
    if (c?.draft) { window.open(c.draft.url, '_blank', 'noopener'); return null; }
    return c?.shard && enter(c) ? c.shard : null;
  };

  // swipe → the track follows the finger (rubber-banded at the ends), release = one page in the swipe direction.
  // QA 11-23-b row 1 (Jake, ~11:15 Cancún: "nothing can be swiped lol on the new zone select", "I have to tab the carousel mini
  // cards lol swipe should work"): J468's swipe look puts the zone's hero full-bleed and its name card in a thin band, so a swipe
  // anywhere on the screen (the hero, the name, the mini heroes) steps the deck, not only one over the name band. A press on a
  // control (BACK, a tab, ENTER ZONE) is the control's. The old carousel keeps its card row as the surface.
  // QA 11-24 row 8 (Jake, ~12:15 Cancún: "you cant fucking swipe on the fucking image on zone select, only on the text, it should be
  // a full screen swipe"; the iOS Simulator showed the zone's name card, a button, refusing every swipe): a swipe may start on any
  // part of the screen below the top bar, the name card, the mini heroes and ENTER ZONE included. A press that starts on a control
  // stays that control's until the finger has travelled SWIPE_SLOP_PX sideways; only then does the deck take the pointer (its lift
  // then lands on the deck, so the control never fires). BACK and the tabs stay theirs.
  const surface = strip === undefined ? list : root;
  const SWIPE_SLOP_PX = 16;
  let drag: { id: number; x0: number; y0: number; t0: number; dx: number; held: boolean } | null = null;
  listenDom(scope, surface, 'pointerdown', (e) => {
    if (listMode() || e.button > 0) return;
    if (drag && drag.id !== e.pointerId && !drag.held) drag = null; // a control's tap kept its lift: that press is over
    if (drag) return;
    const target = e.target instanceof Element ? e.target : null;
    if (surface === root && (target?.closest('.ws-menu-tabs, .ws-menu-back, a, input') ?? null) !== null) return;
    const control = surface === root && (target?.closest('button') ?? null) !== null;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: performance.now(), dx: 0, held: !control };
    if (!control) capturePointer(surface, e.pointerId);
  });
  listenDom(scope, surface, 'pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dx = e.clientX - drag.x0;
    if (!drag.held) {
      if (Math.abs(drag.dx) < SWIPE_SLOP_PX || Math.abs(drag.dx) < Math.abs(e.clientY - drag.y0)) return;
      drag.held = true; capturePointer(surface, e.pointerId);
    }
    const atEnd = (drag.dx > 0 && index === 0) || (drag.dx < 0 && index === entries.length - 1);
    place(index, atEnd ? drag.dx * 0.3 : drag.dx, false);
  });
  const endDrag = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const { dx, t0, held } = drag; drag = null;
    if (!held) return; // a control's own tap
    const v = dx / Math.max(1, performance.now() - t0); // px/ms
    if (Math.abs(dx) > 36 || (Math.abs(v) > 0.35 && Math.abs(dx) > 14)) { swipedAt = performance.now(); select(index + (dx < 0 ? 1 : -1)); }
    else place(index);
  };
  // capture phase: a control's tap stops its own lift (listenTap), and the deck must still see that press end
  listenDom(scope, surface, 'pointerup', endDrag, true); listenDom(scope, surface, 'pointercancel', endDrag, true);
  // a draft opens its tab in the tap's own turn (a popup blocker drops a late one); a gated entry enters the card tapped, even if the
  // deck moved while the gate asked, and ENTER WORLD stays busy meanwhile
  const playButton = required(root, '.ws-menu-play');
  onTap(playButton, () => {
    const at = index;
    const card = entries[at];
    if (card !== undefined && card.shard !== null && canEnter(card, mode()) && opts.single?.closed === undefined) opts.onPress?.(card.slug);
    if (opts.gate === undefined || card?.draft) { activate(at); return; }
    const asked = opts.gate(() => { activate(at); });
    if (!(asked instanceof Promise)) return;
    playButton.setAttribute('aria-busy', 'true'); gating++;
    void asked.finally(() => { playButton.removeAttribute('aria-busy'); gating--; settle(); });
  });
  // EXPLORE-MODE EX1 (J460, QA 47 and 48): no EXPLORE WORLD and no SETTINGS on the deck. Explore is `wildshard dev`'s and the
  // `/slug/<name>?explore` link's (session/play.ts `?explore=`); SETTINGS is the home screen's (mainMenu.ts, J458).
  // QA row 25's Developer pixel card is gone: Settings ▸ Graphics ▸ Pixel density is the one pixel control (MG8, Jake ~23:45)

  // hero art is ~0.2–0.3 MB a file and every card has two (portrait + landscape): only the selected card's, in the
  // orientation on screen, loads with the deck. A neighbour's loads when a swipe or a dot press starts toward it, so the
  // crossfade on release is usually instant (LOAD-PERF, first-launch transfer)
  const warmed = new Set<string>();
  function warm(i: number): void { const c = entries[i]; const u = c ? heroUrl(c) : ''; if (u && !warmed.has(u)) { warmed.add(u); new Image().src = u; } }
  listenDom(scope, surface, 'pointerdown', () => { warm(index - 1); warm(index + 1); });

  // ZS10 (J461): FEATURED, POPULAR, NEW (and Developer's ALL, J469); a press shows that tab's first card
  let tabBar: HTMLElement | null = null;
  const tabButtons: HTMLButtonElement[] = [];
  const markTab = (): void => {
    root.classList.toggle('ws-menu-list', listMode());
    // QA 11-23-b row 1 (Jake: "the all section in zone select has no scrolling behavior no touch scrolling"): index.html cancels
    // every touchmove outside [data-scroll] (no rubber-band page), so a list tab's rows scroll by touch only with the mark
    if (listMode()) list.dataset['scroll'] = ''; else delete list.dataset['scroll'];
    root.dataset['tab'] = tab?.id ?? '';
    tabButtons.forEach((b) => { const on = b.dataset['tab'] === tab?.id; b.setAttribute('aria-selected', String(on)); b.tabIndex = on ? 0 : -1; });
  };
  const showTab = (id: string): void => {
    const next = tabs.find(t => t.id === id);
    if (next === undefined || next === tab) return;
    tab = next; cards = next.cards;
    fill(); bind(); markTab();
    list.scrollTop = 0;
    place(index, 0, false); apply(false);
    opts.onTab?.(next.id);
  };
  if (tabs.length > 0) {
    tabBar = document.createElement('div');
    tabBar.className = 'ws-menu-tabs';
    tabBar.setAttribute('role', 'tablist');
    tabBar.setAttribute('aria-label', GAME_STRINGS.mainMenu.tabs.label);
    tabBar.dataset['count'] = String(tabs.length);
    for (const t of tabs) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'ws-menu-tab'; b.dataset['tab'] = t.id; b.setAttribute('role', 'tab'); b.textContent = t.label;
      onTap(b, () => { showTab(t.id); });
      tabButtons.push(b);
      tabBar.append(b);
    }
  }

  // orientation flips swap the hero file and re-centre the selected card (card width is viewport-relative). iOS (E131): a
  // rotation can fire `resize` before the new layout settles, and may leave the strip natively scrolled — so re-centre
  // whenever the strip's own box really changes too
  let wasPortrait = portrait();
  const onResize = (): void => {
    place(index, 0, false);
    if (portrait() !== wasPortrait) { wasPortrait = portrait(); apply(false); }
    slideStrip(false);
  };
  scope.listen(window, 'resize', onResize);
  const observed = new ResizeObserver(() => { if (!listMode()) list.scrollLeft = 0; if (!drag) place(index, 0, false); slideStrip(false); });
  observed.observe(list);
  scope.onDispose(() => { observed.disconnect(); });

  fill(); bind(); markTab();
  apply(false);
  return {
    root,
    get cards() { return cards; },
    tabBar,
    get tab() { return tab?.id ?? ''; },
    showTab,
    get index() { return index; },
    select, activate,
    start: () => { place(index, 0, false); slideStrip(false); scope.raf(() => { place(index, 0, false); slideStrip(false); }); },
    dispose: () => { scope.dispose(); },
    onTap,
    busy,
    whenIdle: () => busy() ? new Promise<void>((resolve) => { waiting.push(resolve); }) : Promise.resolve(),
  };
}
