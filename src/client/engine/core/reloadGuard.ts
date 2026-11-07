import { saveStorage } from '../saves/slots';
/**
 * The shared budget for reloads a broken page offers or makes (E144): the error modal's RELOAD HERE / TITLE SCREEN
 * (src/client/engine/ui/ErrorModal.ts) and the boot's stuck-loader recovery (src/client/engine/boot/stuck.ts) count into one list, so the two
 * together can never bounce the page in a loop. Dependency-free: the boot entry imports it before the game's graph.
 */

/** reloads inside RELOAD_WINDOW_MS before a broken page stops reloading by itself / stops returning to the spot */
export const RELOADS_MAX = 2;
export const RELOAD_WINDOW_MS = 120_000;
const RELOAD_KEY = 'err.reloads'; // sessionStorage (not `ws.`: the native save mirror copies ws.*)

function session(): ReturnType<typeof saveStorage> | null { return saveStorage('session'); }

/** the reloads counted inside the window, oldest first */
export function recentReloads(): number[] {
  const now = Date.now();
  try { return (JSON.parse(session()?.getItem(RELOAD_KEY) ?? '[]') as number[]).filter((t) => typeof t === 'number' && now - t < RELOAD_WINDOW_MS); } catch { return []; }
}

export function countReload(): void { try { session()?.setItem(RELOAD_KEY, JSON.stringify([...recentReloads(), Date.now()])); } catch { /* not counted */ } }
