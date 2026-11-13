import { titleAssetURL } from './titleAssets';
import { pageScope } from '@wildshard/engine/app/resources';
import { isDev } from '@wildshard/engine/core/devMode';
import { followsTap, listenDom, listenTap } from '@wildshard/engine/input/dom';
import { beginNavigationShell } from '@wildshard/engine/boot/shell';
import { startEntryDownload } from './shardfile/entryTransport';
import { saves } from '@wildshard/engine/saves/runtime';
import { titlePrefetchChoice } from './grid/titlePrefetchChoice';
/**
 * The title screen's shard deck — ONE implementation for both ways in (E318, Jake: "lol wtf why do we have two title
 * screens, one only please"): the cold launch (src/client/engine/ui/StartTitle.ts, renderer-free, before any shard loads) and pause ▸
 * EXIT TO MAIN (src/client/engine/ui/HUD.ts `showIntro`, over the loaded shard) build the same deck from the same cards.
 *
 *   const deck = buildTitleDeck({ cards: titleCards(), onEnter, onExplore, onSettings })
 *   parent.append(deck.root); deck.start()                // after it is in the DOM: centre the selected card
 *   deck.select(i) · deck.index · deck.activate()          // the HUD's arrow keys / any key
 *   deck.dispose()                                          // its resize listeners, when the title goes away
 *
 * A horizontal carousel of shard cards over the selected card's hero art (portrait / landscape by the viewport), dots
 * under it, ENTER WORLD and EXPLORE WORLD, and the main menu's SETTINGS. A swipe steps one card; the centred card is the
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
import { menuMode, selectEnters, selectExplores, type MenuMode } from './grid/menu';
import { pageShardRefusals, refusalReason, type ShardRefusal } from './grid/refusal';
import { playerHidden, titleStatus } from '../../shared/game/grid/catalogueSlot';
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
}

/** Which shards need an upgrade before this client can enter them (G86): the shardfile version each was built for. Every
 *  first-party shard reads at the current format today, so the default is none; the shardfile loader's cached-product
 *  admission (src/client/game/shardfile/product.ts, previous versions) is where an outside author's older shard will report one. */
export type UpgradeNeeded = (slug: string) => number | null;
const noUpgrades: UpgradeNeeded = () => null;
/** Which shards this session refused (G167; `src/client/game/grid/refusal.ts`), default: the page's session record. */
export type RefusedShard = (slug: string) => ShardRefusal | null;
const sessionRefusals: RefusedShard = (slug) => pageShardRefusals().read(slug);

/** Developer mode reveals hidden levels after every player-facing card. */
export function titleCards(showHidden: boolean = isDev(), upgradeNeeded: UpgradeNeeded = noUpgrades, refused: RefusedShard = sessionRefusals): readonly TitleCard[] {
  // a `_` prototype stays Developer only unless its catalogue placement opens it (J313: Mossgate)
  const hidden = (m: TitleManifest): boolean => playerHidden(m);
  const ordinary = titleManifests().filter(m => m.shardSelect !== false);
  const visible = ordinary.filter((m) => !hidden(m));
  const manifests = showHidden ? [...visible, ...ordinary.filter(hidden)] : visible;
  return manifests.map((m): TitleCard => {
    const card: TitleCard = {
    slug: m.slug, name: m.name, label: m.biome,
    thumbnail: m.card.thumb, heroPortrait: m.card.portrait, heroLandscape: m.card.landscape,
    };
    const status = titleStatus(m);
    if (status === 'earlyAccess') card.badge = 'Early access';
    if (status === 'experimental') card.badge = 'Experimental';
    if (status === 'partial') card.badge = 'Partial';
    if (hidden(m)) card.badge = 'Developer only';
    const built = upgradeNeeded(m.slug);
    if (built !== null) card.upgrade = { built };
    const refusal = built === null ? refused(m.slug) : null; // G86's card already says NEEDS UPGRADE
    if (refusal !== null) card.unavailable = refusal;
    return card;
  });
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
  readonly onExplore: (card: TitleCard) => void;
  readonly onSettings: () => void;
  /** a line under the wordmark (the cold launch's "returned to shard select" after an interrupted boot) */
  readonly notice?: string;
  /** what the menu may show and enter (default: Settings ▸ Developer and the DEVSERVER build, read live) */
  readonly mode?: () => MenuMode;
}

export interface TitleDeck {
  readonly root: HTMLElement;
  readonly cards: readonly TitleCard[];
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
}

const SWORD = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 3.5L9 14l1 1L20.5 4.5z M6.5 12.5l5 5 M8 14l-4.5 4.5 1 1L9 15" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>';
const EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';

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
  if (card.draft || card.upgrade !== undefined || card.unavailable !== undefined) return false;
  return selectEnters(card.slug, restricted(card), mode);
}

/** EXPLORE WORLD is a developer tool: only in developer mode (or a DEVSERVER build), and only for a world that can be
 *  entered (Jake, E386) */
function canExplore(card: DeckEntry, mode: MenuMode = menuMode()): boolean {
  return !card.draft && selectExplores(card.slug, restricted(card), mode);
}

/** the tape over a card's image: a world that can't be entered reads COMING SOON, not EXPERIMENTAL (Jake, E386) */
function ribbonFor(card: DeckEntry, mode: MenuMode = menuMode()): string {
  if (card.draft) return mode.developer || mode.devserver ? GAME_STRINGS.drafts.ribbon(card.draft.stage) : GAME_STRINGS.drafts.comingSoon;
  if (card.upgrade !== undefined || card.unavailable !== undefined) return ''; // G86 / G167: the amber badge says it, not a tape
  if (!canEnter(card, mode)) return 'Coming soon';
  return card.badge === 'Developer only' ? GAME_STRINGS.developer.ribbon : card.badge ?? '';
}

/** a dot's tag: the restyled SHARD SELECT (G106, src/client/game/mainMenu.css) draws each dot as a thumbnail with a DEVELOPER tag or a
 *  COMING SOON lock; today's plain dots ignore it */
function dotTag(card: DeckEntry, mode: MenuMode): 'soon' | 'developer' | '' {
  if (!canEnter(card, mode)) return 'soon';
  return restricted(card) ? 'developer' : '';
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
  const { cards } = opts;
  // J313: a draft's card (Thin Ice, off the grid by J305) never loads, so only Developer sees it
  const drafts = mode().developer || mode().devserver ? DRAFT_TITLES : [];
  const entries: readonly DeckEntry[] = [...cards.map(fromShard), ...drafts.map(fromDraft)];
  const activeIndex = entries.map((card): string => card.slug).indexOf(opts.active ?? '');
  const root = document.createElement('div');
  root.className = 'ws-menu';
  root.innerHTML = `
    <div class="ws-menu-hero"></div>
    <div class="ws-menu-head"><div class="ws-wordmark">Project <b>Wildshard</b></div>
      <button class="ws-menu-mode ws-menu-explore" type="button"><span class="ws-menu-mode-glyph">${EYE}</span><span class="ws-menu-explore-text"><b>Explore world</b><small>Fly · inspect</small></span></button></div>
    <div class="ws-menu-deck">
      <div class="ws-menu-cards"><div class="ws-menu-deck-track"></div></div>
      <div class="ws-menu-dots"></div>
      <div class="ws-menu-modes"><button class="ws-menu-mode ws-menu-play" type="button"><span class="ws-menu-mode-glyph">${SWORD}</span><b>Enter world</b><small></small></button></div>
      <div class="ws-menu-row"><button class="ws-menu-settings" type="button">Settings</button></div>
    </div>`;
  const words = (tag: string, cls: string, text: string): HTMLElement => { const node = document.createElement(tag); node.className = cls; node.textContent = text; return node; };
  const cardTrack = required(root, '.ws-menu-deck-track'), dotTrack = required(root, '.ws-menu-dots');
  entries.forEach((card, index) => {
    const active = index === activeIndex, button = document.createElement('button'); button.type = 'button'; button.dataset['i'] = String(index);
    button.className = `ws-menu-card${active ? ' active' : ''}${card.upgrade !== undefined || card.unavailable !== undefined ? ' ws-menu-card-upgrade' : ''}${card.unavailable !== undefined ? ' ws-menu-card-unavailable' : ''}`;
    const image = document.createElement('span'); image.className = 'ws-menu-card-img'; image.style.backgroundImage = `url('${titleAssetURL(card.thumbnail)}')`;
    if (card.upgrade !== undefined) image.append(words('i', 'ws-menu-card-tag ws-menu-card-needs', GAME_STRINGS.upgrade.badge));
    else if (card.unavailable !== undefined) image.append(words('i', 'ws-menu-card-tag ws-menu-card-needs', GAME_STRINGS.unavailable.badge));
    if (canEnter(card, mode())) image.append(words('i', `ws-menu-card-tag${active ? ' ok' : ''}`, active ? 'Loaded' : 'Load'));
    // G238: the port badge, Developer on only (the public card is unchanged)
    const ribbon = ribbonFor(card, mode());
    const tone = !canEnter(card, mode()) ? '' : card.badge === 'Early access' ? ' ws-menu-card-ea' : card.badge === 'Partial' ? ' ws-menu-card-partial' : '';
    if (ribbon !== '') image.append(words('i', `ws-menu-card-exp${tone}`, ribbon));
    const sub = card.upgrade !== undefined ? GAME_STRINGS.upgrade.built(card.upgrade.built) : card.unavailable !== undefined ? refusalReason(card.unavailable) : card.label;
    button.append(image, words('b', '', card.name), words('small', card.unavailable !== undefined ? 'ws-menu-card-reason' : '', sub)); cardTrack.append(button);
    const dot = document.createElement('i'); dot.dataset['i'] = String(index); dot.dataset['tag'] = dotTag(card, mode()); dot.style.setProperty('--thumb', `url('${titleAssetURL(card.thumbnail)}')`); dotTrack.append(dot);
  });
  if (opts.notice) {
    const notice = document.createElement('div');
    notice.className = 'ws-menu-recovery';
    notice.setAttribute('role', 'status');
    notice.textContent = opts.notice;
    required(root, '.ws-menu-head').append(notice);
  }

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
  required(root, '.ws-menu-dots').after(summary);

  const hero = required(root, '.ws-menu-hero');
  const list = required(root, '.ws-menu-cards');
  const track = required(root, '.ws-menu-deck-track');
  const hint = required(root, '.ws-menu-play small');
  const play = root.querySelector<HTMLButtonElement>('.ws-menu-play');
  const explore = root.querySelector<HTMLButtonElement>('.ws-menu-explore');
  if (play === null || explore === null) throw new Error('Title deck: missing entry buttons');
  const cardEls = Array.from(root.querySelectorAll<HTMLElement>('.ws-menu-card'));
  const dots = Array.from(root.querySelectorAll<HTMLElement>('.ws-menu-dots i'));
  const portrait = (): boolean => innerWidth < innerHeight;
  const heroUrl = (c: DeckEntry): string => titleAssetURL(portrait() ? c.heroPortrait : c.heroLandscape);
  let index = Math.max(0, activeIndex);

  // paginated track: one card per swipe, always centred — no native scroll, so it can't rest between cards
  const place = (i: number, extra = 0, animate = true): void => {
    const card = cardEls[i];
    if (card === undefined) return;
    track.style.transition = animate ? 'transform 0.32s cubic-bezier(0.2, 0.8, 0.2, 1)' : 'none';
    track.style.transform = `translateX(${list.clientWidth / 2 - (card.offsetLeft + card.offsetWidth / 2) + extra}px)`;
  };
  const apply = (): void => {
    const c = entries[index];
    if (c === undefined) return;
    cardEls.forEach((e, i) => { e.classList.toggle('selected', i === index); });
    dots.forEach((d, i) => { d.classList.toggle('on', i === index); });
    // the card's own thumbnail (already on screen in the card) under the hero: until the hero's bytes arrive and decode
    // (a phone network, a busy page), the backdrop is the card's picture, never black (Jake's Pine Hollow, ab93dccfe)
    hero.style.backgroundImage = `url('${heroUrl(c)}'), url('${titleAssetURL(c.thumbnail)}')`;
    hero.classList.add('show');
    hint.textContent = hintFor(c, index === activeIndex, mode());
    play.disabled = !canEnter(c, mode()) && c.draft === null;
    explore.disabled = !canExplore(c, mode());
    explore.classList.toggle('off', !canExplore(c, mode())); // menu.css hides .off
    required(play, 'b').textContent = c.draft ? (isDev() ? GAME_STRINGS.drafts.draftMode : GAME_STRINGS.drafts.followBuild) : c.upgrade !== undefined ? GAME_STRINGS.upgrade.badge : c.unavailable !== undefined ? GAME_STRINGS.unavailable.badge : canEnter(c, mode()) ? 'Enter world' : 'Coming soon';
    paintSummary(c);
  };
  const select = (raw: number, smooth = true): void => {
    const i = Math.max(0, Math.min(entries.length - 1, raw));
    place(i, 0, smooth);
    if (i !== index) { index = i; apply(); }
  };
  // the card is entered through its shardfile, whose download starts first
  let entering = false;
  const enter = (c: DeckEntry): boolean => {
    if (entering) return false;
    if (c.shard === null || !canEnter(c, mode())) return false;
    const shard = c.shard;
    entering = true;
    startEntryDownload(c.slug); titlePrefetchChoice(saves).remember(c.slug);
    const attempt = beginNavigationShell(c.name, scope, () => { opts.onEnter(shard); }, play);
    attempt.onDispose(() => { entering = false; });
    return true;
  };
  /** ENTER WORLD, or a key: the shard's one entry (its shardfile, G531 / LD5). The card it started entering, if any (MG5) */
  const activate = (): TitleCard | null => {
    const c = entries[index];
    // A draft opens on the drafts site (J16, J19): FOLLOW THE BUILD shows its teaser, DRAFT MODE its pages (Developer on there).
    if (c?.draft) { window.open(c.draft.url, '_blank', 'noopener'); return null; }
    return c?.shard && enter(c) ? c.shard : null;
  };

  // swipe → the track follows the finger (rubber-banded at the ends), release = one page in the swipe direction
  let drag: { id: number; x0: number; t0: number; dx: number } | null = null;
  listenDom(scope, list, 'pointerdown', (e) => {
    if (drag) return;
    drag = { id: e.pointerId, x0: e.clientX, t0: performance.now(), dx: 0 };
    list.setPointerCapture(e.pointerId);
  });
  listenDom(scope, list, 'pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag.dx = e.clientX - drag.x0;
    const atEnd = (drag.dx > 0 && index === 0) || (drag.dx < 0 && index === entries.length - 1);
    place(index, atEnd ? drag.dx * 0.3 : drag.dx, false);
  });
  let swipedAt = 0; // a swipe's trailing click must not re-select the card under the finger
  const endDrag = (e: PointerEvent): void => {
    if (!drag || e.pointerId !== drag.id) return;
    const { dx, t0 } = drag; drag = null;
    const v = dx / Math.max(1, performance.now() - t0); // px/ms
    if (Math.abs(dx) > 36 || (Math.abs(v) > 0.35 && Math.abs(dx) > 14)) { swipedAt = performance.now(); select(index + (dx < 0 ? 1 : -1)); }
    else place(index);
  };
  listenDom(scope, list, 'pointerup', endDrag); listenDom(scope, list, 'pointercancel', endDrag);
  // a click that only follows the title's SHARD SELECT tap lands where that tap was, not on a card or dot (QC2)
  cardEls.forEach((e, i) => { listenDom(scope, e, 'click', (ev) => { ev.stopPropagation(); if (!followsTap(ev) && i !== index && performance.now() - swipedAt > 400) select(i); }); });
  dots.forEach((d, i) => { listenDom(scope, d, 'click', (ev) => { ev.stopPropagation(); if (!followsTap(ev)) select(i); }); });
  onTap(required(root, '.ws-menu-play'), () => { activate(); });
  onTap(required(root, '.ws-menu-explore'), () => { const c = entries[index]; if (c?.shard && canExplore(c, mode())) opts.onExplore(c.shard); });
  onTap(required(root, '.ws-menu-settings'), opts.onSettings);
  // QA row 25's Developer pixel card is gone: Settings ▸ Graphics ▸ Pixel density is the one pixel control (MG8, Jake ~23:45)

  // hero art is ~0.2–0.3 MB a file and every card has two (portrait + landscape): only the selected card's, in the
  // orientation on screen, loads with the deck. A neighbour's loads when a swipe or a dot press starts toward it, so the
  // crossfade on release is usually instant (LOAD-PERF, first-launch transfer)
  const warmed = new Set<string>();
  const warm = (i: number): void => { const c = entries[i]; const u = c ? heroUrl(c) : ''; if (u && !warmed.has(u)) { warmed.add(u); new Image().src = u; } };
  listenDom(scope, list, 'pointerdown', () => { warm(index - 1); warm(index + 1); });
  dots.forEach((d, i) => { listenDom(scope, d, 'pointerdown', () => { warm(i); }); });

  // orientation flips swap the hero file and re-centre the selected card (card width is viewport-relative). iOS (E131): a
  // rotation can fire `resize` before the new layout settles, and may leave the strip natively scrolled — so re-centre
  // whenever the strip's own box really changes too
  let wasPortrait = portrait();
  const onResize = (): void => {
    place(index, 0, false);
    if (portrait() !== wasPortrait) { wasPortrait = portrait(); apply(); }
  };
  scope.listen(window, 'resize', onResize);
  const strip = new ResizeObserver(() => { list.scrollLeft = 0; if (!drag) place(index, 0, false); });
  strip.observe(list);
  scope.onDispose(() => { strip.disconnect(); });

  apply();
  return {
    root, cards,
    get index() { return index; },
    select, activate,
    start: () => { place(index, 0, false); scope.raf(() => { place(index, 0, false); }); },
    dispose: () => { scope.dispose(); },
    onTap,
  };
}
