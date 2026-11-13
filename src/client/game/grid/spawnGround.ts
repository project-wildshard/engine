/**
 * PINE-FLASH (opus-pineflash, 2026-11-13): control never arrives over the entered cell's coarse far proxy.
 *
 * Pine's runtime draws its pines, grass and road, but its ground is the cell's own L1 / L0 ring tiles (D189). Since engine
 * 93e50340 the entered cell admits them, but only once the grid's background opens (T10: 3 s of play after control), so the
 * first seconds of control showed the far proxy's tan canyon walls around the spawn (opus-rel16's GC spawn shots, v0.1.16).
 *
 * The loader's `spawnDetail` step now holds for that ground: the cell's tile views are admitted at once, every L1 quadrant
 * (the far proxy hides region by region as each uploads) and the spawn's L0 ring are pinned, and the step ends when they
 * are published or after `SPAWN_GROUND_LIMIT_MS`, so a slow tile never hangs the load (the rings keep masking the proxy as
 * the rest arrives in play). A cell whose runtime draws its own ground (Nalati's `cellGround: 'world'`, a runtime holding the
 * tile registration) or a page with no runtime-drawn cell holds nothing: today's path. Driftwood's ground is its ring tiles
 * too (its hill showed the proxy's smooth mound, no stairs, at control), so it holds as well: 0.4 s headless, Pine 0.6 s.
 */
import type { TileRequirement } from '@wildshard/engine/world/tileStreamer';

/** The hold's ceiling (ms). Pine's whole wait measured 0.6 s in a headless preview; past this the loader goes on and the rings finish
 *  the ground in play, as they did before the hold. */
export const SPAWN_GROUND_LIMIT_MS = 8000;
/** The far proxy's 4 x 4 L1 quadrants (`z * 4 + x`), each hiding one far region when it uploads. */
export const L1_QUADRANTS: readonly number[] = Array.from({ length: 16 }, (_, key) => key);

/** How the hold ended: nothing to hold, ground published, the ceiling, or an admission that failed (the proxy stays). */
export type SpawnGround = 'none' | 'ready' | 'timeout' | 'failed';

/** The entered cell to hold for: drawn by its regional runtime, whose ground is its ring tiles. Null: nothing to hold. */
export function spawnGroundCell(drawn: string | null, registered: boolean, ownGround: boolean): string | null {
  return drawn !== null && !registered && !ownGround ? drawn : null;
}

/** What one hold needs from the grid session. */
export interface SpawnGroundPorts {
  readonly instance: string;
  /** offer the cell's tile views to the rings (false: its inputs are deferred, so no tile can come) */
  readonly admit: () => Promise<boolean>;
  /** pin tiles on the page's one streamer (`TileStreamer.require`) */
  readonly require: (instance: string, keys: Iterable<number>, level: 'l1') => TileRequirement;
  /** pin the spawn's L0 ring until `release` (the registration's `prepareOffered`), if the page has one */
  readonly spawn?: () => Promise<void>;
  /** step the rings while `entry` waits and no page frame steps them (`stepRingsUntil`) */
  readonly pump: (entry: Promise<unknown>) => Promise<unknown>;
  /** resolve after `ms` on the page's scope */
  readonly after: (ms: number) => Promise<void>;
  readonly limitMs?: number;
}

/** Hold until the entered cell's ground covers its far proxy and its spawn ring is published, or the ceiling. The caller
 *  releases what the hold pinned (its scope) once this settles. */
export async function holdSpawnGround(ports: SpawnGroundPorts, held: (requirement: TileRequirement) => void): Promise<SpawnGround> {
  let over = false;
  const ground = (async (): Promise<SpawnGround> => {
    try {
      if (!await ports.admit()) return 'none';
      if (over) return 'timeout'; // admitted after the ceiling: the caller has released its pins, so pin nothing new
      const coarse = ports.require(ports.instance, L1_QUADRANTS, 'l1'); held(coarse);
      await Promise.all([coarse.ready, ports.spawn?.()]);
      return 'ready';
    } catch (error: unknown) {
      // past the ceiling the caller's release rejects the pins: that is the hold ending, not a failure
      if (!over) console.warn(`[grid] ${ports.instance} spawn ground not held`, error);
      return 'failed';
    }
  })();
  const ceiling = (async (): Promise<SpawnGround> => { await ports.after(ports.limitMs ?? SPAWN_GROUND_LIMIT_MS); return 'timeout'; })();
  const ended = Promise.race([ground, ceiling]);
  void ports.pump(ended);
  try { return await ended; } finally { over = true; }
}
