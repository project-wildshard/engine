import * as v from 'valibot';

/** C2 (J28, J134): each product's server class as one content-named part, so a deployed build has no `/server-class/`
 *  tree, and the rest of what a server reads in `more`, small parts it fetches only for a file the page can't lend. The book
 *  is per build, like the packs book, and only the server worker reads it: it is in no client manifest, the precache never
 *  names it, and anyone can download it, so nothing secret goes in a server file (J134). */
export interface ServerPackPart {readonly url: string; readonly bytes: number; readonly hash: string; readonly wireBytes: number; readonly files: readonly (readonly [string, number, number])[]}
export interface ServerPack extends ServerPackPart {readonly more?: readonly ServerPackPart[]}
export interface ServerPackBook {readonly book: 'server'; readonly build: string; readonly shards: Readonly<Record<string, ServerPack>>; /** C2: the road's collision, one per catalogue. */ readonly grid?: ServerPack}
const size = v.pipe(v.number(), v.safeInteger(), v.minValue(0));
const partEntries = {url: v.pipe(v.string(), v.regex(/^\/assets\/spawn\/server\/[a-f0-9]{16}\.pack\.br$/u)), bytes: size, hash: v.pipe(v.string(), v.regex(/^[a-f0-9]{64}$/u)), wireBytes: size,
  files: v.array(v.strictTuple([v.string(), size, size]))};
const ServerPackSchema: v.GenericSchema<ServerPack> = v.strictObject({...partEntries, more: v.exactOptional(v.array(v.strictObject(partEntries)))});
const ServerPackBookSchema: v.GenericSchema<ServerPackBook> = v.strictObject({book: v.literal('server'), build: v.string(), shards: v.record(v.string(), ServerPackSchema), grid: v.exactOptional(ServerPackSchema)});
export const serverPackBookPath = (build: string): string => `assets/spawn/server-${build}.json`;
export const readServerPackBook = (input: unknown): ServerPackBook => v.parse(ServerPackBookSchema, input);
/** One shard's pack, as the cook writes it beside its parts (`assets/spawn/server-<slug>-<hash16>.json`). */
export const readServerPack = (input: unknown): ServerPack => v.parse(ServerPackSchema, input);
/** J83, MS2.4: the cook's index of one shard's bytes (its shardfile hash) for one build, written last, so a shard is cooked when it exists. */
export const cookIndexPath = (build: string, hash: string): string => `index/${build}/${hash}.json`;
/** SA47: what a server reads of a cook index: whose it is, and where its server pack is (an index from before C2 names none). */
export interface CookedServerIndex {readonly build: string; readonly slug: string; readonly hash: string; readonly serverPack?: {readonly index: string}}
const CookedServerIndexSchema: v.GenericSchema<CookedServerIndex> = v.object({build: v.string(), slug: v.string(), hash: v.string(),
  serverPack: v.exactOptional(v.object({index: v.pipe(v.string(), v.regex(/^\/assets\/spawn\/server-[a-z0-9_-]+-[a-f0-9]{16}\.json$/u))}))});
export const readCookedServerIndex = (input: unknown): CookedServerIndex => v.parse(CookedServerIndexSchema, input);
/** The part of a pack that holds a file. */
export const serverPackPart = (pack: ServerPack, path: string): ServerPackPart | undefined => [pack, ...pack.more ?? []].find(part => part.files.some(file => file[0] === path));
/** One file's bytes inside its part's decoded body. */
export function serverPackFile(pack: ServerPackPart, body: Uint8Array, path: string): Uint8Array | undefined {
  const row = pack.files.find(file => file[0] === path);
  return row === undefined ? undefined : body.subarray(row[1], row[1] + row[2]);
}
