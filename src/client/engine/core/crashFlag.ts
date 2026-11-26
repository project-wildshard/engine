/**
 * `?crash=<mode>` — force an error to test the fault isolation and the error modal (E133). The one spot this flag lives;
 * the GAME-NORMALIZATION plan's flag registry takes it over as is.
 *
 *   ?crash=system   a frame-loop system ("crash-test") throws every frame from 4 s in: switched off after 3 frames, the
 *                   game keeps rendering, a quiet chip, a report on the server
 *   ?crash=fatal    a CORE system throws every frame from 4 s in: the loop stops, the fatal modal
 *   ?crash=window   an uncaught error in a timer 4 s in (window.onerror, the world running): the chip, a report
 *   ?crash=boot     the boot throws: the fatal modal over the loader
 *   ?crash=revision 4 s into play, the room's newer revision reloads the page (J501 reloadPlay, code REV-RELOAD), as roomsRevision.ts does
 *   ?crash=seat     4 s into play, the world seats the page where it can't go (J501 endPlay, code SEAT-NOPAGE), as pageEntry.ts does
 *
 * Dev builds only — or a reviewer who unlocked Settings → REVIEW with the password. A production player who types it
 * gets a console line and nothing else. A reload from the modal drops the flag (ErrorModal.ts), so it never follows you.
 */
import type { Game } from './Game';
import { reviewUnlocked } from '../ui/review';
import { endPlay, reloadPlay } from '../boot/endPlay';

const AFTER_S = 4;

export function installCrashFlag(game: Game, params: URLSearchParams): void {
  const mode = params.get('crash');
  if (mode === null) return;
  if (!import.meta.env.DEV && !reviewUnlocked()) { console.warn('[crash] ?crash= works in dev builds and for unlocked reviewers only'); return; }
  console.warn(`[crash] forcing a "${mode}" error`);
  const boom = (): never => { throw new Error(`forced ${mode} error (?crash=${mode})`); };
  switch (mode) {
    case 'boot': boom(); break;
    case 'system': game.onUpdate((_dt, t) => { if (t > AFTER_S) boom(); }, 'crash-test'); break;
    case 'fatal': game.onUpdate((_dt, t) => { if (t > AFTER_S) boom(); }, 'crash-test.core', true); break;
    case 'window': game.levelScope.timeout(AFTER_S * 1000, boom); break;
    // J501's two in-play exits: the flag leaves the address first, so the page they lead to never forces them again
    case 'revision': case 'seat': game.levelScope.timeout(AFTER_S * 1000, () => {
      const url = new URL(location.href); url.searchParams.delete('crash'); history.replaceState(history.state, '', url);
      const zone = game.level.id; // CP4, CP22 (J522): the running zone, named by no address
      if (mode === 'revision') reloadPlay({ code: 'REV-RELOAD', zone, revision: 'forced0rev000', retry: true, why: `Forced (?crash=revision): the world runs a newer version of ${zone || 'this zone'} than this page had, so the page reloaded to switch to it, and didn't make it back in.` });
      else endPlay({ code: 'SEAT-NOPAGE', zone, room: 'forced-cell', why: 'Forced (?crash=seat): the world server seated you in forced-cell, a place this build can\'t open, so the game went back to the title.' }, new URL(location.pathname, location.origin));
    }); break;
    default: console.warn(`[crash] unknown mode "${mode}": system | fatal | window | boot | revision | seat`);
  }
}
