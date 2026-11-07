// Game vocabulary extends the engine's named random streams with the loot stream.
// A merge file, so every layer project and narrowed program that includes `*.merge.d.ts` sees it without an import.
import type { RngStream } from '@wildshard/engine/core/rng';

declare module '@wildshard/engine/core/rng' {
  interface RngStreams { loot: true }
}

/** The game's own named stream. */
export type GameRngStream = Extract<RngStream, 'loot'>;
