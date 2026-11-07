import type { BootSpec } from '../../../shared/engine/level/spec';
import type { HorizonStrips } from '../world/HorizonMatte';
import type { Ktx2Table } from './gpuFiles';

/**
 * The levels the boot and the background download know about (E405 AG28): the game installs its registry here at the
 * start of a session (src/client/game/session/session.ts), so the engine's boot code imports no game module.
 *
 *   setBootCatalog({ levels, playable, find, artBytes })   // the game, before the level boots
 *   bootCatalog().playable                                 // src/client/engine/boot/shardPrefetch.ts, extras.ts
 */
export interface BootLevel {
  readonly slug: string;
  /** the title deck's pictures; the menu preload points them at their decoded in-memory copies */
  readonly card: { thumb: string; portrait: string; landscape: string };
  readonly boot?: BootSpec;
  readonly ktx2?: () => Promise<{ GPU_FILES: Ktx2Table }>;
  readonly horizonStrips?: HorizonStrips;
}
export interface BootCatalog {
  /** every level with a title card */
  readonly levels: readonly BootLevel[];
  /** the ones the background download visits */
  readonly playable: readonly BootLevel[];
  readonly find: (slug: string) => BootLevel | undefined;
  /** bundled art: URL → bytes */
  readonly artBytes: Readonly<Record<string, number>>;
}

let installed: BootCatalog | null = null;
export function setBootCatalog(catalog: BootCatalog): void { installed = catalog; }
export function bootCatalog(): BootCatalog {
  if (installed === null) throw new Error('Boot catalog: the game installs it (setBootCatalog) before a level boots');
  return installed;
}
