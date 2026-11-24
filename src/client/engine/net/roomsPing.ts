/**
 * QA-FEEDBACK 11-24 row 36 (Jake, 15:05 Cancún: "server latency and ping as a dev chip somewhere at the top, so fps, memory and
 * server latency"): the live rooms link says its round trip once a second as a `ws:rooms-ping` document event. online.js is a
 * bundle of its own (shell.ts), so the page's Developer ping chip (ui/pingChip.ts) hears it through the document, not a shared
 * module. `rttMs` is null while the link is not live or has no pong yet.
 *
 *   document.dispatchEvent(new CustomEvent(ROOMS_PING_EVENT, { detail: { rttMs: 42 } satisfies RoomsPing }));
 */
export const ROOMS_PING_EVENT = 'ws:rooms-ping';
/** how often the link says it, ms */
export const ROOMS_PING_EVERY_MS = 1000;
export interface RoomsPing { readonly rttMs: number | null }
/** the round trip a chip shows: whole ms, or null for no live measure (0, NaN, a dead link) */
export function roomsPingMs(rttMs: number | undefined, live: boolean): number | null {
  return live && rttMs !== undefined && Number.isFinite(rttMs) && rttMs > 0 ? Math.round(rttMs) : null;
}
