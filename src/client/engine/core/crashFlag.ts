/**
 * `?crash=<mode>` — force an error to test the fault isolation and the error modal (E133). The one spot this flag lives;
 * the GAME-NORMALIZATION plan's flag registry takes it over as is.
 *
 *   ?crash=system   a frame-loop system ("crash-test") throws every frame from 4 s in: switched off after 3 frames, the
 *                   game keeps rendering, a quiet chip, a report on the server
 *   ?crash=fatal    a CORE system throws every frame from 4 s in: the loop stops, the fatal modal
 *   ?crash=window   an uncaught error in a timer 4 s in (window.onerror, the world running): the chip, a report
 *   ?crash=boot     the boot throws: the fatal modal over the loader
 *
 * Dev builds only — or a reviewer who unlocked Settings → REVIEW with the password. A production player who types it
 * gets a console line and nothing else. A reload from the modal drops the flag (ErrorModal.ts), so it never follows you.
 */
import type { Game } from './Game';
import { reviewUnlocked } from '../ui/review';

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
    default: console.warn(`[crash] unknown mode "${mode}": system | fatal | window | boot`);
  }
}
