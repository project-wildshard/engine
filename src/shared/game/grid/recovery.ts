import * as v from 'valibot';
import type { SaveKeyDef, SaveStore } from '@wildshard/engine/saves/store';
import type { GridAssembly } from './assembly';
import { onRoad, type RoadPoint } from './roadRecovery';
import { instanceSave, instanceSaveIdentity, type LocalSaveInstance } from '../instanceSaves';

const finite = v.pipe(v.number(), v.finite());
const identity = v.pipe(v.string(), v.regex(/^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u));
const roadSchema = v.strictObject({ x: finite, z: finite, yaw: finite });
const locationSchema: v.GenericSchema<BoundedGridLocationInput, BoundedGridLocation> = v.variant('kind', [
  v.strictObject({ kind: v.literal('road') }),
  v.strictObject({ kind: v.literal('cell'), x: finite, y: finite, z: finite, yaw: finite }),
]);
const savedSchema = v.strictObject({ instance: identity, slug: identity,
  catalogue: v.pipe(v.string(), v.maxLength(4096)), at: finite, road: roadSchema, location: locationSchema });
/** A durable location references the instance's real continuation; it carries no progress or native bytes. */
export type GridSavedLocation = v.InferOutput<typeof locationSchema>;
/** A durable place: the instance, the road beside it and where in it the player stood. */
export interface GridSavedPlace { readonly instance: string; readonly slug: string; readonly road: { readonly x: number; readonly z: number; readonly yaw: number }; readonly location: GridSavedLocation }
/** SR4: where the server's durable continuation stands, as its site document names it: a cell's instance, or null on the road. */
export interface GridServerSite { readonly site: string | null }
/** The site a page's place stands in, in the server's terms. */
export function placeSite(place: Pick<GridSavedPlace, 'instance' | 'location'>): string | null {
  return place.location.kind === 'cell' ? place.instance : null;
}
const lastDefinition = { key: 'grid.last-played', scope: 'device' as const, version: 1, schema: v.nullable(savedSchema), initial: () => null };
const localDefinition = { ...lastDefinition, key: 'platform.grid-position', scope: 'shard' as const };
const guardDefinition = { key: 'grid.recovery.guard', scope: 'device' as const, version: 1,
  schema: v.nullable(v.strictObject({ at: finite })), initial: () => null };
const resetDefinition = { key: 'grid.reset.pending', scope: 'device' as const, version: 1,
  schema: v.nullable(v.strictObject({ instance: identity, slug: identity, catalogue: v.pipe(v.string(), v.maxLength(4096)),
    at: finite, road: roadSchema, target: v.strictObject({ id: identity, shard: identity }),
    generation: v.pipe(v.number(), v.safeInteger(), v.minValue(0)) })), initial: () => null };
const schema: v.GenericSchema<BoundedGridRecoveryInput, BoundedGridRecovery> = v.nullable(v.strictObject({ instance: identity, slug: identity,
  catalogue: v.pipe(v.string(), v.maxLength(4096)), at: finite,
  reason: v.picklist(['gpu', 'background', 'new-game', 'reload']),
  road: roadSchema,
  saved: v.optional(savedSchema),
}));
/** A recovery location only: progress remains in the existing instance saves, never copied into this record. */
export type GridRecoveryRecord = v.InferOutput<typeof schema>;
/** A planned update continues play at its admitted pose; graphics recovery still needs RESUME. */
export function plannedGridReload(record: GridRecoveryRecord | undefined): boolean {
  return record?.reason === 'reload';
}
/** Only a planned reload without a saved pose needs the initial descent. */
export function initialGridReload(record: GridRecoveryRecord | undefined): boolean {
  return plannedGridReload(record) && record?.saved === undefined;
}
/** GPU loss, long absence and New game may resume; a crossing never writes or consumes this protocol. */
export type GridRecoveryReason = NonNullable<GridRecoveryRecord>['reason'];
const definition: SaveKeyDef<GridRecoveryRecord> = { key: 'grid.recovery.once', scope: 'session', version: 1, schema, initial: () => null };
const backup: SaveKeyDef<GridRecoveryRecord> = { ...definition, scope: 'device' };
const MAX_AGE_MS = 60_000;

/** Stable identities plus actual placement seal the selected catalogue without tying saves to cell coordinates. */
export function recoveryCatalogue(assembly: GridAssembly): string {
  return JSON.stringify({ pitch: assembly.pitch, cells: assembly.cells.map(cell => [cell.instance, cell.slug, ...cell.cell]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))) });
}
/** Renderer-free consumption result; malformed, expired or unsafe recovery chooses a fresh safe road start. */
export type GridRecoveryRead = { readonly kind: 'none' | 'fallback' | 'refused' | 'loop' } | { readonly kind: 'resume'; readonly record: NonNullable<GridRecoveryRecord> };

/** Renderer-free persistence ports; locations and pending resets are never crossing reloads. */
export interface GridRecoveryService {
  write: (assembly: GridAssembly, home: { instance: string; slug: string }, road: RoadPoint, reason: GridRecoveryReason) => boolean;
  /** Call only after every continuation/ledger writer succeeds. The instance slot fences New-game generations. */
  save: (assembly: GridAssembly, home: { instance: string; slug: string }, road: RoadPoint, location: GridSavedLocation) => boolean;
  clearLoop: () => boolean;
  /** The last durable place, for a server opening a page's save for the first time. */
  lastPlace: (assembly: GridAssembly) => GridSavedPlace | null;
  /** An abrupt end may resume only an already durable, catalogue-bound checkpoint. SR4: the page's place is lazily committed
   *  storage and a killed browser can lose its newest writes, while the server's continuation is durable. `server` is every
   *  site document of the server's the page could read: a place must stand where each of them does, so whichever one the
   *  server's own stricter read boots from agrees with it. Otherwise it is stale, and resumes nothing: the title's GRID tap
   *  resumes the server's own (J190). */
  restoreLast: (assembly: GridAssembly, server?: readonly GridServerSite[]) => boolean;
  /** A pending reset never boots until the target namespace proves its atomic generation advance. */
  prepareReset: (assembly: GridAssembly, current: { instance: string; slug: string }, road: RoadPoint, target: LocalSaveInstance) => boolean;
  completeReset: (assembly: GridAssembly) => boolean;
  consume: (assembly: GridAssembly, unexpected?: boolean) => GridRecoveryRead;
}
/** Recovery-only metadata is mirrored for a replaced WebContent process and consumed before any boot allocation. */
export function gridRecovery(store: SaveStore, now: () => number = Date.now): GridRecoveryService {
  const session = store.define(definition), device = store.define(backup);
  const last = store.define(lastDefinition), guard = store.define(guardDefinition);
  const pendingReset = store.define(resetDefinition);
  const valid = (record: GridRecoveryRecord, assembly: GridAssembly): record is NonNullable<GridRecoveryRecord> => record !== null
    && now() - record.at >= 0 && now() - record.at <= MAX_AGE_MS
    && record.catalogue === recoveryCatalogue(assembly)
    && assembly.cells.some(cell => cell.instance === record.instance && [record.slug].includes(cell.slug))
    && onRoad(assembly, record.road.x, record.road.z);
  const validSaved = (saved: v.InferOutput<typeof savedSchema>, assembly: GridAssembly): boolean => {
    const cell = assembly.cells.find(row => row.instance === saved.instance && [saved.slug].includes(row.slug));
    if (cell === undefined || saved.catalogue !== recoveryCatalogue(assembly) || !onRoad(assembly, saved.road.x, saved.road.z)) return false;
    if (saved.location.kind === 'cell') {
      const world = assembly.world(saved.location, cell);
      if (assembly.at(world.x, world.z)?.instance !== cell.instance) return false;
    }
    const local = instanceSave(store, localDefinition, { id: saved.instance, shard: saved.slug });
    return JSON.stringify(local.peek()) === JSON.stringify(saved);
  };
  const service: GridRecoveryService = {
    save: (assembly, home, road, location) => {
      const saved = v.parse(savedSchema, { instance: home.instance, slug: home.slug, road: { ...road }, location, catalogue: recoveryCatalogue(assembly), at: now() });
      const cell = assembly.cells.find(row => row.instance === home.instance && [home.slug].includes(row.slug));
      if (cell === undefined || !onRoad(assembly, road.x, road.z)) throw new Error('Durable location requires an admitted instance and safe road');
      if (location.kind === 'cell') {
        const world = assembly.world(location, cell);
        if (assembly.at(world.x, world.z)?.instance !== home.instance) throw new Error('Durable location is outside its instance');
      }
      const local = instanceSave(store, localDefinition, { id: home.instance, shard: home.slug });
      return local.write(saved) && last.write(saved);
    },
    clearLoop: () => guard.write(null),
    lastPlace: assembly => { const saved = last.peek(); return saved !== null && validSaved(saved, assembly) ? saved : null; },
    restoreLast: (assembly, server) => {
      if ([last.status?.(), session.status?.(), device.status?.(), pendingReset.status?.()].includes('future')
        || session.peek() !== null || device.peek() !== null) return false;
      const saved = last.peek();
      if (saved === null || !validSaved(saved, assembly)) return false;
      if (server?.some(row => row.site !== placeSite(saved)) === true) return false;
      return service.write(assembly, saved, saved.road, 'reload');
    },
    prepareReset: (assembly: GridAssembly, current: { instance: string; slug: string }, road: RoadPoint, target: LocalSaveInstance) => {
      if (!assembly.cells.some(cell => cell.instance === current.instance && [current.slug].includes(cell.slug)) || !onRoad(assembly, road.x, road.z)
        || !assembly.cells.some(cell => cell.instance === target.id && [target.shard].includes(cell.slug))) throw new Error('Reset recovery requires catalogue instances and a safe road');
      return pendingReset.write({ instance: current.instance, slug: current.slug, road: { ...road }, target: { ...target },
        catalogue: recoveryCatalogue(assembly), at: now(), generation: store.inspectShardGeneration(instanceSaveIdentity(target)) });
    },
    completeReset: (assembly) => {
    const pending = pendingReset.peek();
    if (pending === null || now() - pending.at < 0 || now() - pending.at > MAX_AGE_MS || pending.catalogue !== recoveryCatalogue(assembly)) return false;
    if (store.inspectShardGeneration(instanceSaveIdentity(pending.target)) !== pending.generation + 1) return false;
    const selected = assembly.cells.find(cell => cell.instance === pending.instance && [pending.slug].includes(cell.slug));
    if (selected === undefined || !onRoad(assembly, pending.road.x, pending.road.z)) return false;
    if (!service.save(assembly, selected, pending.road, { kind: 'road' }) || !service.write(assembly, selected, pending.road, 'new-game')) return false;
    return pendingReset.write(null);
    },
    write: (assembly, home, road, reason) => {
      const saved = last.peek();
      const selected = saved !== null && validSaved(saved, assembly) ? saved : undefined;
      const record = v.parse(schema, { instance: selected?.instance ?? home.instance, slug: selected?.slug ?? home.slug,
        road: selected?.road ?? { ...road }, ...(selected === undefined ? {} : { saved: selected }), reason, catalogue: recoveryCatalogue(assembly), at: now() });
      if (!valid(record, assembly)) throw new Error('Recovery requires an admitted home and safe road location');
      const inSession = session.write(record), onDevice = device.write(record);
      // A blocked sessionStorage may retain a memory-only copy; never require that phantom copy on the next read.
      if (!inSession) session.write(null);
      return inSession || onDevice;
    },
    consume: (assembly, unexpected = false) => {
      if (pendingReset.status?.() === 'future') return { kind: 'refused' as const };
      // The process can die between resetShard's atomic write and its success callback. Only an exact durable
      // generation advance completes that road receipt; a declined/failed reset remains an ordinary title boot.
      const pending = pendingReset.peek();
      if (pending !== null && !service.completeReset(assembly) && !pendingReset.write(null)) return { kind: 'refused' as const };
      const statuses = [session.status?.(), device.status?.()];
      const records = [session.peek(), device.peek()];
      // Unknown future records remain untouched and cannot initiate a boot in an older client.
      if (statuses.includes('future')) return { kind: 'refused' };
      const resumed = guard.peek();
      const looping = resumed !== null && now() - resumed.at >= 0 && now() - resumed.at < 600_000;
      if (records.every(value => value === null) && !statuses.includes('invalid')) return { kind: unexpected && looping ? 'loop' : 'none' };
      // Consume every present copy durably before allocation: refusal leaves the ordinary title route.
      const inSession = session.write(null), onDevice = device.write(null);
      if (((records[0] !== null || statuses[0] === 'invalid') && !inSession) || ((records[1] !== null || statuses[1] === 'invalid') && !onDevice)) return { kind: 'refused' };
      if (looping) return { kind: 'loop' };
      const record = records.find((value): value is NonNullable<GridRecoveryRecord> => valid(value, assembly) && (value.saved === undefined || validSaved(value.saved, assembly)));
      if (record !== undefined) return guard.write({ at: now() }) ? { kind: 'resume', record } : { kind: 'refused' };
      return { kind: records.some(value => value !== null) || statuses.some(status => status === 'invalid') ? 'fallback' : 'none' };
    },
  };
  return service;
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedGridRecoveryInput = BoundedGridRecovery;
type BoundedGridRecovery = {
    instance: string;
    slug: string;
    catalogue: string;
    at: number;
    reason: "gpu" | "background" | "new-game" | "reload";
    road: {
        x: number;
        z: number;
        yaw: number;
    };
    saved?: {
        instance: string;
        slug: string;
        catalogue: string;
        at: number;
        road: {
            x: number;
            z: number;
            yaw: number;
        };
        location: {
            kind: "road";
        } | {
            kind: "cell";
            x: number;
            y: number;
            z: number;
            yaw: number;
        };
    } | undefined;
} | null;
type BoundedGridLocationInput = BoundedGridLocation;
type BoundedGridLocation = {
    kind: "road";
} | {
    kind: "cell";
    x: number;
    y: number;
    z: number;
    yaw: number;
};
