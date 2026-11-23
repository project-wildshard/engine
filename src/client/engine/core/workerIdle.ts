/**
 * ENGINE-MEMORY EM19 (design rule 5, "a worker is a budgeted isolate"). On iOS every worker is a thread inside the tab's
 * WebContent process, so its JavaScript heap, its code and, for the Zstd and Basis decoders, a Wasm heap grown to their
 * largest job (Wasm memory never shrinks) count against the same jetsam limit as the page. On the phone tier an idle decode
 * worker therefore retires seconds after its last job instead of holding through control for 30 s, and the terrain tile
 * pool is one worker, not two. The next job starts a worker again, as after the 30 s idle today.
 */
import { TIER } from './tier';

/** How long an idle decode worker lives on the phone tier, and elsewhere. */
export const PHONE_DECODER_IDLE_MS = 2_000, DECODER_IDLE_MS = 30_000;

/** The idle lifetime of a decode worker on this page's tier (read when the idle timer is armed: the tier is set at boot). */
export function decoderIdleMs(): number { return TIER === 'phone' ? PHONE_DECODER_IDLE_MS : DECODER_IDLE_MS; }

/** A decode pool's worker count on this page's tier: one on the phone. */
export function decodePoolSize(desktop: number): number { return TIER === 'phone' ? 1 : desktop; }

/**
 * Whether an idle worker that drew on an OffscreenCanvas retires at all (DRIFTWOOD-FPS DF14). Chromium ends such a
 * worker by finishing its GPU command buffer, and the page's main thread waits in `DidTerminateWorkerThread` until it
 * does: the far impostor decoder's 30 s retire was a 55 ms frame on the desktop route (a trace, 2026-11-23). The phone
 * tier still retires it, for the jetsam budget above; elsewhere it lives with the page.
 */
export function canvasWorkerRetires(): boolean { return TIER === 'phone'; }
