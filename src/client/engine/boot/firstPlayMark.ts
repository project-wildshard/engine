import { jsonSlot } from '../saves/slots';
/**
 * MOBILE-GRAPHICS MG5 / MG6: whether this device has finished its first play (a device save, `firstPlayDone`), and whether the
 * title has just started one (a session save, so the card shows in the page the title hands over to). The title decides,
 * the game shows the card (src/client/game/firstPlay.ts), main menu ▸ Settings ▸ Replay first-time setup clears the mark.
 */

const done = jsonSlot('firstPlayDone', 'device'), pending = jsonSlot('firstPlay.pending', 'session');

/** Whether this device finished its first play (true when storage is blocked: no flow that cannot end). */
export function firstPlayDone(): boolean { try { return done.read() === true; } catch { return true; } }
/** MG6: forget it, so the next PLAY runs the first play again. */
export function resetFirstPlay(): void { try { done.write(false); } catch { /* storage blocked: nothing to replay */ } }
/** The title is entering the first play: the card shows once the player has control. */
export function startFirstPlay(): void { try { pending.write(true); } catch { /* storage blocked: no card this time */ } }
/** Whether the title started a first play this session. */
export function firstPlayPending(): boolean { try { return pending.read() === true; } catch { return false; } }
/** DONE: the device has had its first play. */
export function finishFirstPlay(): void { try { done.write(true); pending.write(false); } catch { /* storage blocked: the card may show again */ } }
