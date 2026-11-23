/** FM4 9b: the tab-scoped mark that the shell heard the world close `restart`. The online bundle writes it (`titleHold.ts`); the
 *  title reads it before it loads that bundle (QA 11-23-b row 5, Jake: "when i hit enter zone on zone select its not instant in
 *  going to the loading sreen"), so ENTER ZONE asks the world only when a restart says it may be down. */
const RESTART_KEY = 'ws:world-restart';
/** A restart heard this long ago no longer explains a quiet world. */
export const RESTART_RECENT_MS = 180_000;

/** The shell heard the world close `restart` (mode 9). Kept for this tab, across the title's navigation. */
export function noteRestart(now: number = Date.now()): void {
  // oxlint-disable-next-line wildshard/no-raw-save -- one tab-scoped mark the title reads; online.js has no save store (OF4)
  try { sessionStorage.setItem(RESTART_KEY, String(now)); } catch { /* a page that keeps nothing guesses nothing */ }
}
/** Seated again: the restart is over. */
export function clearRestart(): void {
  // oxlint-disable-next-line wildshard/no-raw-save -- the same tab-scoped mark
  try { sessionStorage.removeItem(RESTART_KEY); } catch { /* nothing kept */ }
}
/** Whether this tab heard a restart in the last RESTART_RECENT_MS. */
export function restartRecent(now: number = Date.now()): boolean {
  // oxlint-disable-next-line wildshard/no-raw-save -- the same tab-scoped mark
  try { const at = Number(sessionStorage.getItem(RESTART_KEY)); return at > 0 && now - at >= 0 && now - at < RESTART_RECENT_MS; } catch { return false; }
}
