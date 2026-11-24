import { recordDrop, type EndContext } from './dropNotice';
import { markReload, markUnload } from './lastEnd';
import { replaceFresh } from './freshPage';
/**
 * The one way the game leaves play by itself (J501, Jake 2026-11-23 ~11:40 Cancún, after Enter MMO into Signal Dunes dropped him
 * to the main menu with no word: "Any mismatch like this should never drop me the main menu ... always show me the fucking error
 * modal"). Every exit the player did not choose names a short code and says why first, so the title opens the drop modal
 * (src/client/app/dropModal.ts) with that code and Retry, and reports the same code to Sentry with its zone, revision, room and step.
 *
 *   endPlay({ code: 'SEAT-NOPAGE', why: 'The world seated you in …', zone, retry: true })   record the drop, leave for the title
 *   reloadPlay({ code: 'REV-RELOAD', why: '…', zone, revision })   the game's own reload that should resume play: marked, so the next
 *                                                                   page never reads it as the player's reload (the quiet title)
 *   showEnd({ code: 'NOT-IN-WORLD', why: '…' })                     a title already on screen: record it, the title's take shows it
 *
 * The player's own exits stay as they are (leftByPlayer, then the navigation). test/no-silent-exit.test.ts refuses any other
 * navigation in src/client that says nothing first.
 */

/** Every code an exit can carry. Short, stable and searchable: Sentry's `exit_code` tag and the modal's CODE line. */
export const END_CODES = {
  'REV-RELOAD': 'the world runs a newer revision of this zone; the page reloads onto it',
  'REV-BEHIND': 'the world still runs a newer revision after the one reload',
  'SEAT-NOPAGE': 'the world seated the player in a zone this build cannot open',
  'SEAT-LOOP': 'the world kept moving the seat; re-entry stopped',
  'ONE-CELL': 'a one-zone world seated a zone this build cannot open alone',
  'NOT-IN-WORLD': 'the world does not open the zone the page was sent to',
  'UNLISTED': 'the address names a world this build does not list',
  'ENTRY-GATE': 'Enter MMO could not ask the world whether it is up',
  'RESTORE-FAIL': 'the world could not be restored after the last session ended',
  'BOOT-FAIL': 'the game hit an error while starting',
  'DROP-MODAL': 'the error modal itself could not open',
} as const;
export type EndCode = keyof typeof END_CODES;

export interface EndReason extends EndContext {
  readonly code: EndCode;
  /** why, in plain words, for the modal */
  readonly why: string;
  /** the modal's headline; default "Couldn't enter <zone>" */
  readonly what?: string;
  readonly error?: unknown;
  /** the modal offers Retry: trying again can work (a moving seat, a gate that timed out), not a build that lacks the zone */
  readonly retry?: boolean;
}

/** the page's own navigation; a test passes its own */
export interface EndNavigation { readonly leave: (to: string | URL) => void; readonly reload: () => void }
const BROWSER: EndNavigation = { leave: (to) => { replaceFresh(to); }, reload: () => { location.reload(); } };

const said = (reason: EndReason): string => `${reason.code}: ${reason.why}`.slice(0, 200);
function record(reason: EndReason): void {
  const { code, why, what, error, retry, zone, revision, room, step } = reason;
  recordDrop({ reason: why, code, ...(what === undefined ? {} : { what }), ...(error === undefined ? {} : { error }), ...(retry === true ? { retry } : {}),
    context: { ...(zone === undefined ? {} : { zone }), ...(revision === undefined ? {} : { revision }), ...(room === undefined ? {} : { room }), ...(step === undefined ? {} : { step }) } });
}

/** The game leaves play for the title by itself: the drop is recorded, the unload says why, and the title shows the modal. */
export function endPlay(reason: EndReason, to: string | URL = '/', nav: EndNavigation = BROWSER): void {
  record(reason);
  markUnload(`end play ${said(reason)}`);
  nav.leave(to);
}

/**
 * The game's own reload that should land back in play (a revision swap). The drop is recorded too: a reload that resumes clears
 * it when the world reaches Playing (dropNotice's markStep), and one that ends on the title shows it with its code.
 */
export function reloadPlay(reason: EndReason, nav: EndNavigation = BROWSER): void {
  record(reason);
  // 'background': the engine's own reload that resumes (chunk recovery's kind); 'reload' would send the next boot to the title
  markReload(`engine reload ${said(reason)}`, 'background');
  nav.reload();
}

/**
 * What a boot step throws once it has called endPlay or reloadPlay: the page is already leaving, with its drop recorded. The boot's
 * catch (src/client/app/entry.ts, the session's) reads it with `isLeavingPlay` and shows no error card and files no report: the
 * modal the next page shows is the one the player sees (QA-FEEDBACK-2026-11-24 row 20, Sentry WILDSHARD-GAME-BX and BP).
 */
export class LeavingPlayError extends Error {
  override readonly name = 'LeavingPlayError';
  readonly leavingPlay = true;
}
/** Whether `error` (or one it wraps as its `cause`) says the page is already leaving play through this funnel. */
export function isLeavingPlay(error: unknown): boolean {
  for (let at = error, depth = 0; typeof at === 'object' && at !== null && depth < 4; at = Reflect.get(at, 'cause'), depth++) {
    if (Reflect.get(at, 'leavingPlay') === true) return true;
  }
  return false;
}

/** A title already on screen (the boot chose it): record the drop; the title's drop notice shows it once, with its code. */
export function showEnd(reason: EndReason): void { record(reason); }
