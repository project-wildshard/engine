// SERVER-PARITY SS3: the per-host record of which SS2 server halves an installer built. The game's installers register here
// (a game module can't import the host layer); src/server/host/installers.ts names each key's owners and checks a product.
import type { SimHost } from '@wildshard/engine/sim';

/** Every server key shard-format's SS2 side table (`featureSides`) names for a `both` or `server` kind. */
export type ServerInstallerKey = 'arenaRoom' | 'collision' | 'fallFloor' | 'grapple' | 'harvest' | 'heldArms' | 'heldBoss' | 'heldRanged' | 'keepsakes'
  | 'loadout' | 'melee' | 'movers' | 'places' | 'portalRide' | 'poseViews' | 'questComposition' | 'questHost' | 'ropeDecks' | 'saves' | 'slots'
  | 'stealth' | 'windElite';

const installed = new WeakMap<SimHost, Set<ServerInstallerKey>>();

/** An installer built `key`'s server half on `host`. Install and restore both register; the record lives as long as the host. */
export function registerInstalled(host: SimHost, key: ServerInstallerKey): void {
  const keys = installed.get(host);
  if (keys === undefined) installed.set(host, new Set([key])); else keys.add(key);
}
/** The keys whose installers ran on `host`. */
export function installedKeys(host: SimHost): ReadonlySet<ServerInstallerKey> { return installed.get(host) ?? new Set(); }
