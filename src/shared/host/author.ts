import { parseShardfile, type Shardfile } from '@wildshard/engine/host/shardfile';
import { ENTRY_WIDTH } from '@wildshard/format/contentBounds';
import { SHARDFILE_VERSION } from '@wildshard/format/version';

/** FORMAT-PRUNE FP26 (J493): an identity with its save lineage under either spelling (`saveRevision` from format 0.1.0.4,
 *  `revision` before), so authors and fixtures build on a format pin either side of the rename. */
export type AuthorIdentity = Readonly<Omit<Shardfile['identity'], 'saveRevision' | 'revision'> & ({ saveRevision: number } | { revision: number })>;
/** Start an author project with a valid empty world; add baked content before shipping a playable shard. */
export function emptyShardfile(identity: AuthorIdentity): Shardfile {
  const edge = { heights: Array.from({ length: 257 }, () => 0), colours: Array.from({ length: 257 }, () => [0.5, 0.5, 0.5]), roadHeight: 0 };
  return parseShardfile({ version: SHARDFILE_VERSION, identity, accent: 'sand', requires: { capabilities: [], commons: [], commonsWire: {}, commonsCosts: {} }, budgets: { library: { resident: 0, compressed: 0 }, sim: { resident: 0, compressed: 0 }, overlap: 0 },
    entryways: [{ edge: 'north', at: [0, 0, 250], width: ENTRY_WIDTH }, { edge: 'east', at: [250, 0, 0], width: ENTRY_WIDTH }, { edge: 'south', at: [0, 0, -250], width: ENTRY_WIDTH }, { edge: 'west', at: [-250, 0, 0], width: ENTRY_WIDTH }],
    look: { families: [], grade: { exposure: 0, saturation: 1, contrast: 1, lut: null }, clock: 'engine', dayOverride: null, keys: [] },
    sim: { fixedHz: 60, scriptTickDivisor: 2, commandVersion: 0, snapshotVersion: 0, scripts: [] },
    state: { version: 1, sharedOwner: 'host', playerKey: 'actorId', shared: [], player: [] }, authorCaps: { players: 32, speed: 15 },
    serverBudget: { tickMicros: 1000, memory: 1_000_000, entities: 100, commandsPerTick: 32 }, edge: { north: edge, south: edge, east: edge, west: edge }, files: [], tiles: [], library: [], critical: [], far: null });
}
