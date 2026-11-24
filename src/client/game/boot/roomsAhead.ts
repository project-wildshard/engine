// QA-FEEDBACK-2026-11-24 row 20 (J501's last silent exit; Sentry WILDSHARD-GAME-BX and BP): a page older than its zone's world,
// caught while loading (`spawnDownload.ts`, NB2's `behindRooms`), threw a plain Error. The player saw "the game failed to start" and
// Sentry filed a fatal boot error. It now leaves through the J501 funnel: one marked reload onto the rooms' revision (REV-RELOAD),
// and when the page is still behind after it, the title's drop modal with REV-BEHIND and Retry. The reload is the one
// `heardRooms` (roomsRevision.ts) gives: both share the tab's `reloaded` hint, so a hash is reloaded for once, whoever saw it first.
import { endPlay, LeavingPlayError, reloadPlay, type EndReason } from '@wildshard/engine/boot/endPlay';
import { bareSlug } from '../../../shared/game/grid/catalogueSlot';
import { sessionHints, type RoomsHints } from '../grid/roomsRevision';

let left = false;
/** What the page did: reloaded onto the rooms' revision, went to the title's modal, or had already left (one exit a page). */
export type RoomsAheadExit = 'reload' | 'behind' | 'gone';

/** The funnel's two exits; a test passes its own. */
export interface RoomsAheadExits { readonly reloadPlay: (reason: EndReason) => void; readonly endPlay: (reason: EndReason, to: string) => void }
const FUNNEL: RoomsAheadExits = { reloadPlay: reason => { reloadPlay(reason); }, endPlay: (reason, to) => { endPlay(reason, to); } };
/** Leave play for a zone whose rooms run `hash` this page could not load. Returns the error its caller throws to stop the boot;
 *  the boot's catch reads it as a page that is leaving (`isLeavingPlay`), so no error card and no report follow. */
export function leaveForRoomsRevision(slug: string, hash: string, hints: RoomsHints = sessionHints(), exits: RoomsAheadExits = FUNNEL): { exit: RoomsAheadExit; error: LeavingPlayError } {
  const zone = bareSlug(slug), short = hash.slice(0, 12);
  const error = new LeavingPlayError(`${zone}: the world runs a newer revision (${short}) than this page has`);
  if (left) return { exit: 'gone', error };
  left = true;
  const kept = hints.read();
  if (hints.durable !== false && kept.reloaded[zone] !== hash) {
    hints.write({ ...kept, reloaded: { ...kept.reloaded, [zone]: hash } });
    exits.reloadPlay({ code: 'REV-RELOAD', zone, revision: hash, retry: true,
      why: `The world runs a newer version of ${zone} (${short}) than this page had, so the page reloaded to switch to it, and didn't make it back in.` });
    return { exit: 'reload', error };
  }
  exits.endPlay({ code: 'REV-BEHIND', zone, revision: hash, retry: true,
    why: `The world runs a newer version of ${zone} (${short}) than this page could load, even after reloading once. Retry, or try again in a minute.` }, '/');
  return { exit: 'behind', error };
}

/** Tests only: a fresh page. */
export function resetRoomsAheadForTest(): void { left = false; }
