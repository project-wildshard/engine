import { jsonSlot } from '../saves/slots';
/**
 * MOBILE-GRAPHICS MG5 / MG6: whether this device has finished its first play (a device save, `firstPlayDone`), and the title's
 * intent to run one now (a session save, so it survives the hand-over to the shard's page): bound to the shard it enters and
 * good for ten minutes, consumed when the card shows, and dropped by any other entry. The title decides, the game shows the
 * card (src/client/game/firstPlay.ts), main menu ▸ Settings ▸ Replay first-time setup clears the device mark.
 */

const done = jsonSlot('firstPlayDone', 'device'), pending = jsonSlot('firstPlay.pending', 'session');
/** how long a title's first-play intent waits for its shard to reach control */
const INTENT_MS = 10 * 60_000;
/** the event the title sends when it arms a first play (a page whose shard is already in control shows the card at once) */
export const FIRST_PLAY_EVENT = 'ws:first-play';

/** Whether this device finished its first play (true when storage is blocked: no flow that cannot end). */
export function firstPlayDone(): boolean { try { return done.read() === true; } catch { return true; } }
/** MG6: forget it, so the next PLAY runs the first play again. */
export function resetFirstPlay(): void { try { done.write(false); } catch { /* storage blocked: nothing to replay */ } }

/** The title is entering `slug` for the first play. False when the intent cannot be kept across the hand-over (blocked or full
 *  storage): the title then enters the ordinary way. */
export function startFirstPlay(slug: string, now: number = Date.now()): boolean {
  let kept = false;
  try { kept = pending.write({ slug, at: now }); } catch { kept = false; }
  if (kept && typeof document !== 'undefined') document.dispatchEvent(new CustomEvent(FIRST_PLAY_EVENT));
  return kept;
}
/** Any other entry (SHARD SELECT, the grid, Explore) drops a first play the title armed and the shard never reached. */
export function dropFirstPlay(): void { try { if (pending.read() !== null) pending.write(null); } catch { /* storage blocked: nothing kept */ } }

/** Whether the title armed a first play for `slug` that is still fresh. */
export function firstPlayPending(destination: string, now: number = Date.now()): boolean {
  try {
    const raw: unknown = pending.read();
    if (raw === null || typeof raw !== 'object') return false;
    const armed: unknown = Reflect.get(raw, 'slug'), at: unknown = Reflect.get(raw, 'at');
    return armed === destination && typeof at === 'number' && now >= at && now - at <= INTENT_MS;
  } catch { return false; }
}
/** The card showed: the intent is spent (a reload before DONE runs the first play again from the title, as the mark is unset). */
export function takeFirstPlay(): void { dropFirstPlay(); }
/** DONE: the device has had its first play. */
export function finishFirstPlay(): void { try { done.write(true); } catch { /* storage blocked: the title asks again next time */ } dropFirstPlay(); }
