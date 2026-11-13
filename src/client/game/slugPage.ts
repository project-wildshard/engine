/**
 * SA36 (meta SHARD-AUTHORING-PLAN; Jake, grill 2026-11-12 Q14 to Q18): the `/slug/<slug>` page, the link a sharddev author shares
 * with friends. "it's kind of like SHARD SELECT. But instead of being shard select it has exactly one shard, the slugName, and it
 * has the hero image of it, and it will dynamically load that hero / slug / shard etc, and spawn you into the infinite grid there."
 *
 *   const view = buildSlugPage({ manifest, placed, onEnter, onExplore, onSettings })   // a TitleDeckView for showStartTitle
 *
 * It is Shard Select's own deck (src/client/game/titleDeck.ts) holding that one card, dressed the same (mainMenu.css
 * `.ws-menu-carousel`): the card, its hero behind, PLAY, SETTINGS. PLAY is ENTER WORLD: the same shardfile download, loading
 * shell and `onEnter`, which src/client/app/entry.ts points at `travel`, so the next page enters the grid at the shard's cell
 * exactly as a Shard select tap does (grid/oneWayIn.ts). A slug with no grid cell (not placed yet, `--no-place`, an off-grid
 * shard such as Thin Ice) keeps its card and hero with PLAY disabled: "Not on the grid yet" (Q16). MAIN MENU leaves for `/`.
 */
import { pageScope } from '@wildshard/engine/app/resources';
import { mobileDevice } from '@wildshard/engine/boot/titleArrival';
import { dropFirstPlay, firstPlayDone, startFirstPlay } from '@wildshard/engine/boot/firstPlayMark';
import { askNameOnce, nameAskDue } from '@wildshard/engine/ui/namePrompt';
import type { TitleDeckView } from '@wildshard/engine/ui/HUD';
import { buildTitleDeck, titleCard, type TitleCard, type TitleDeckOptions } from './titleDeck';
import type { TitleManifest } from './shard/titleList';
import { GAME_STRINGS } from '../../shared/game/strings';
import './mainMenu.css';
import './slugPage.css';

export interface SlugPageOptions extends Pick<TitleDeckOptions, 'onExplore' | 'onSettings' | 'notice' | 'mode'> {
  /** the shard the link names (its title row) */
  readonly manifest: TitleManifest;
  /** the grid places this shard: PLAY enters it at its cell. False: PLAY is disabled, "Not on the grid yet" */
  readonly placed: boolean;
  /** PLAY, once the name is asked and the loading shell is up (the deck's ENTER WORLD) */
  readonly onEnter: (card: TitleCard) => void;
}

/** One shard's page over Shard Select's deck. */
export function buildSlugPage(opts: SlugPageOptions): TitleDeckView {
  const owner = pageScope.child('slug-page');
  const s = GAME_STRINGS.slugPage;
  const card = titleCard(opts.manifest);
  // MG5 (as the main menu arms it): a phone's first play arms its first-play card for this shard; any other entry drops one
  const phone = mobileDevice(navigator.userAgent, navigator.platform, navigator.maxTouchPoints);
  // MMO-PLAN MP2.4 (as the main menu asks it): a device's first PLAY asks for the Name once, then enters
  let naming = false;
  const gate = (go: () => void): void => {
    if (naming || !opts.placed) return; // a slug with no cell enters nothing, so it asks nothing
    if (!nameAskDue()) { go(); return; }
    naming = true;
    void askNameOnce(owner, { parent: document.body }).then(answered => { naming = false; if (answered && !owner.disposed) go(); return undefined; },
      () => { naming = false; });
  };
  const deck = buildTitleDeck({
    cards: [card], active: null, onSettings: opts.onSettings, gate,
    ...(opts.notice === undefined ? {} : { notice: opts.notice }), ...(opts.mode === undefined ? {} : { mode: opts.mode }),
    single: { play: s.play, hint: s.placed, ...(opts.placed ? {} : { closed: s.unplaced }) },
    onEnter: (entered) => { if (!(phone && !firstPlayDone() && startFirstPlay(entered.slug))) dropFirstPlay(); opts.onEnter(entered); },
    onExplore: (entered) => { dropFirstPlay(); opts.onExplore(entered); },
  });
  deck.root.classList.add('ws-menu-carousel', 'ws-slug');
  deck.root.dataset['slug'] = card.slug;
  deck.root.dataset['placed'] = String(opts.placed);
  const bar = document.createElement('div');
  bar.className = 'ws-menu-bar';
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'ws-menu-back';
  back.textContent = s.menu;
  const title = document.createElement('div');
  title.className = 'ws-menu-title';
  title.textContent = GAME_STRINGS.mainMenu.logo;
  bar.append(back, title);
  deck.root.querySelector('.ws-menu-head')?.prepend(bar);
  deck.onTap(back, () => { location.assign('/'); });
  const root = document.createElement('div');
  root.className = 'ws-title-stack';
  root.dataset['screen'] = 'slug';
  root.append(deck.root);
  return {
    root, cards: deck.cards,
    get index() { return deck.index; },
    select: (i, smooth) => { deck.select(i, smooth); },
    activate: () => { gate(() => { deck.activate(); }); },
    start: () => { deck.start(); },
    dispose: () => { owner.dispose(); deck.dispose(); },
  };
}
