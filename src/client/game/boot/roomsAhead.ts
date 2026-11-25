// QA-FEEDBACK-2026-11-24 row 20 (J501's last silent exit; Sentry WILDSHARD-GAME-BX and BP): a page older than its zone's world,
// caught while loading (`spawnDownload.ts`, NB2's `behindRooms`), threw a plain Error. It left through the J501 funnel instead: one
// reload onto the rooms' revision, then the title's REV-BEHIND modal.
// QA-FEEDBACK-2026-11-25 row 35 (the OB10 class): on staging v0.1.89 Mossgate's rooms ran r25 before the cook had written its packs
// for the build (the cook index 404s), and that funnel looped: REV-BEHIND sent the page to the title, the title's read-ahead of the
// selected zone hit the same refusal and left again, 76 loads in 90 s, ending black. Now a page that can't load its zone's revision
// stays where it is: one steady "this zone is updating" card, which checks the cook's index again on a ladder (10, 20, 40, then every
// 60 s) and reloads only once the index is there, never sooner than a minute after this page loaded. The card never leaves between
// checks, and the title's read-ahead never navigates (`spawnSelection` leaves only for a foreground download).
import { reloadPlay, LeavingPlayError, type EndReason } from '@wildshard/engine/boot/endPlay';
import { leftByPlayer } from '@wildshard/engine/boot/dropNotice';
import { replaceFresh } from '@wildshard/engine/boot/freshPage';
import { Scope } from '@wildshard/engine/app/scope';
import { diagnosticNow } from '@wildshard/engine/core/clock';
import { mountUi } from '@wildshard/engine/ui/ownership';
import { bareSlug } from '../../../shared/game/grid/catalogueSlot';
import { findTitleManifest } from '../shard/titleList';
import { behindRecheck } from './placedSpawn';

/** The checks' waits: 10 s, 20 s, 40 s, then every minute. */
export const RECHECK_LADDER_MS: readonly number[] = [10_000, 20_000, 40_000, 60_000];
/** No reload sooner than this after the page loaded (the last reload, when a reload brought it here). */
export const RELOAD_GAP_MS = 60_000;

let left = false;
/** What the page did: stayed on the updating card, or had already (one card a page). */
export type RoomsAheadExit = 'waiting' | 'gone';

/** The waiting card's world; a test passes its own. */
export interface RoomsWaitPorts {
  /** Owns the card and its timers. */
  readonly scope: Scope;
  /** Milliseconds since this page loaded. */
  readonly now: () => number;
  /** Whether the page can load the rooms' revision now (the cook's index for this build and those bytes is there). */
  readonly recheck: () => Promise<boolean>;
  /** The reload onto it, marked (J501). */
  readonly reloadPlay: (reason: EndReason) => void;
  /** The player's own way out. */
  readonly back: () => void;
  /** Where the card goes. */
  readonly mount: (card: HTMLElement, scope: Scope) => void;
}
function pagePorts(slug: string): RoomsWaitPorts {
  const recheck = behindRecheck(slug);
  return {
    scope: new Scope('rooms-ahead-wait'), now: diagnosticNow, // since this page loaded
    // a zone marked behind with no way to ask again: the reload asks, at most once a minute
    recheck: recheck ?? (() => Promise.resolve(true)),
    reloadPlay: reason => { reloadPlay(reason); },
    back: () => { leftByPlayer('zone updating: back to title'); replaceFresh('/'); },
    mount: (card, scope) => { const doc: { body: HTMLElement | null } = document; mountUi(card, scope, doc.body ?? document.documentElement); },
  };
}

const STYLE = `
  #wszoneupdating { position: fixed; inset: 0; z-index: var(--ws-layer-error, 2147482500); display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)); background: rgba(4, 9, 14, 0.62); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); color: #e6f2f8; font: 12px/1.5 "JetBrains Mono", ui-monospace, Menlo, monospace; }
  #wszoneupdating .box { box-sizing: border-box; width: min(440px, 100%); padding: 22px 18px 16px; background: rgba(13, 27, 38, 0.9); border: 1px solid rgba(143, 227, 255, 0.35); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55); }
  #wszoneupdating .tag { margin: 0 0 10px; font-size: 10px; letter-spacing: 0.32em; text-transform: uppercase; color: #8fe3ff; }
  #wszoneupdating h1 { margin: 0 0 10px; font: 700 21px/1.2 Rajdhani, "JetBrains Mono", sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #fff; overflow-wrap: anywhere; }
  #wszoneupdating p { margin: 0 0 14px; font-size: 13px; color: #cfe9f3; }
  #wszoneupdating .status { color: #8fe3ff; letter-spacing: 0.06em; }
  #wszoneupdating button { appearance: none; -webkit-appearance: none; width: 100%; min-height: 48px; padding: 12px 14px; cursor: pointer; font: 700 11px/1 "JetBrains Mono", monospace; letter-spacing: 0.22em; text-transform: uppercase; border: 1px solid rgba(143, 227, 255, 0.35); background: rgba(143, 227, 255, 0.06); color: #8fe3ff; touch-action: manipulation; }
`;

/** The page can't load the revision `hash` its zone's rooms run: show the updating card and stay. Returns the error its caller throws
 *  to stop the boot; the boot's catch reads it as a page that is leaving (`isLeavingPlay`), so no error card and no report follow. */
export function leaveForRoomsRevision(slug: string, hash: string, ports?: RoomsWaitPorts): { exit: RoomsAheadExit; error: LeavingPlayError } {
  const zone = bareSlug(slug), short = hash.slice(0, 12);
  const error = new LeavingPlayError(`${zone}: the world runs a newer revision (${short}) than this page has; waiting for it`);
  if (left) return { exit: 'gone', error };
  left = true;
  let name = zone;
  try { name = findTitleManifest(zone)?.name ?? zone; } catch { /* no title list on this page: the slug names it */ }
  waitForRevision(zone, hash, name, ports ?? pagePorts(zone));
  return { exit: 'waiting', error };
}

function waitForRevision(zone: string, hash: string, name: string, ports: RoomsWaitPorts): void {
  const { scope, now } = ports;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text = ''): HTMLElementTagNameMap[K] => {
    const el = document.createElement(tag); if (className !== '') el.className = className; if (text !== '') el.textContent = text; return el;
  };
  if (document.getElementById('wszoneupdating-style') === null) { const style = make('style', ''); style.id = 'wszoneupdating-style'; style.textContent = STYLE; document.head.append(style); }
  const card = make('div', ''); card.id = 'wszoneupdating';
  card.setAttribute('role', 'status'); card.setAttribute('aria-live', 'polite');
  card.dataset['zone'] = zone; card.dataset['revision'] = hash;
  const box = make('div', 'box'), status = make('p', 'status'), back = make('button', 'back', 'Back to title');
  back.type = 'button';
  box.append(make('p', 'tag', 'Zone updating'), make('h1', '', `${name} is updating`),
    make('p', '', `The world moved ${name} to a new version, and its files for this game build are still being prepared. This page keeps trying on its own.`),
    status, back);
  card.append(box);
  scope.listen(back, 'click', () => { scope.dispose(); ports.back(); });
  scope.onDispose(() => { card.remove(); });
  ports.mount(card, scope);

  let tries = 0, due = 0, state: 'waiting' | 'checking' | 'ready' = 'waiting';
  const paint = (): void => {
    const secs = Math.max(0, Math.ceil((due - now()) / 1000));
    card.dataset['state'] = state; card.dataset['tries'] = String(tries);
    status.textContent = state === 'checking' ? 'Checking now…' : state === 'ready' ? `Ready. Joining in ${String(secs)} s.` : `Trying again in ${String(secs)} s.`;
  };
  const go = (): void => {
    if (scope.disposed) return;
    ports.reloadPlay({ code: 'REV-RELOAD', zone, revision: hash, retry: true,
      why: `${name} was updating; its new version (${hash.slice(0, 12)}) became ready, so the page reloaded to load it, and didn't make it back in.` });
  };
  const wait = (ms: number, then: () => void): void => { due = now() + ms; paint(); scope.timeout(ms, then); };
  const check = async (): Promise<void> => {
    state = 'checking'; paint();
    const ready = await ports.recheck().catch(() => false);
    if (scope.disposed) return;
    if (ready) { state = 'ready'; wait(Math.max(0, RELOAD_GAP_MS - now()), go); return; }
    tries++; state = 'waiting';
    wait(RECHECK_LADDER_MS[Math.min(tries, RECHECK_LADDER_MS.length - 1)] ?? RELOAD_GAP_MS, () => { void check(); });
  };
  console.info(`[rooms] ${zone} runs ${hash.slice(0, 12)}, which this page can't load yet: the updating card checks again on a ladder`);
  scope.interval(1000, paint);
  wait(RECHECK_LADDER_MS[0] ?? RELOAD_GAP_MS, () => { void check(); });
}

/** Tests only: a fresh page. */
export function resetRoomsAheadForTest(): void { left = false; }
