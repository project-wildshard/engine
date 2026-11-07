import type { BufferGeometry, Vector3 } from 'three';
import type { ModelDef } from '../../../../client/engine/models/model';
/**
 * Interactables kit — the DATA schema (A2, project/archive/2026-09-23-driftwood-remaster.md). Every chest, key, door, lever, pressure
 * plate, barrel, pickup, beacon, bench and altar on a shard is one plain-JSON row of an `InteractTable`; nothing is code
 * per placement. The rows talk to each other (and to quests) only through FLAGS — plain strings in a `Flags` store:
 *
 *   automatic flags an interactable raises           what raises it
 *   `open:<id>`                                      a chest / door opened
 *   `taken:<id>`                                     a pickup / key taken
 *   `lever:<id>`                                     a lever is pulled (toggles)
 *   `plate:<id>`                                     a plate is pressed right now (transient, never persisted)
 *   `lit:<id>`                                       a beacon lit
 *   `used:<id>`                                      a bench sat on / an altar used
 *   `key:<keyId>`                                    you hold that key (a key pickup, or a chest's contents)
 *   anything in `sets`                               the row's own extra flag(s), raised with the automatic one
 *
 * and they react through CONDITIONS (`Cond`): `{ all?, any?, none? }` over flags. A door with `opensWhen` opens by
 * itself (plates, levers); `requires` gates the E action (a locked-away strongbox, the altar's three shards); `showWhen`
 * hides a row until its condition holds (a key that appears where the sailor fell). Flags a row reads but nothing in the
 * table raises (`dead:sailor`, `talked:castaway`) are declared in `external` — `validateTable` (validate.ts) proves every
 * flag read is raised by something, every lock has a key, every id is unique: the shape a chunk upload would be checked
 * against before the server loads it as config.
 *
 * Placement: `at` is a point in a POI's local frame (`poi` + local x / z, `yaw` in the same frame; world = POI origin +
 * R_y(POI rotation) · local), or `poi: 'world'` for world
 * coordinates. `anchor` names a model-supplied point (`wreck.holdDoor`) that wins over x / z when the model exports it.
 * y comes from the walkable floor there (platforms, else the terrain) unless `y` pins it (absolute) or `dy` lifts it.
 */

/** Frozen compatibility vocabulary: remove with legacy shards (NEXT N5).
 * Live placement rows use QuestPlace and authored frame records instead. */
export type PoiId = 'world' | 'hut' | 'lookout' | 'wreck' | 'shrine' | 'cave' | 'pier';
/** Generic authored placement; `world` selects untransformed coordinates. */
export interface QuestPlace {
  poi: string;
  x: number;
  z: number;
  /** facing in the POI's frame (radians about +Y; 0 = the model's front faces +Z) */
  yaw?: number;
  /** absolute world y — skips the floor lookup */
  y?: number;
  /** metres above the floor found at (x, z) */
  dy?: number;
  /** a model anchor name (`<poi>.<name>`, e.g. `wreck.holdDoor`); used instead of x / z / yaw when the model exports it */
  anchor?: string;
}

/** Frozen compatibility placement: remove with legacy shards (NEXT N5). */
export interface Place extends QuestPlace { poi: PoiId }

/** A borrowed world-space quest anchor; an explicit height bypasses floor lookup. */
export interface QuestPlaceAnchor { readonly x: number; readonly z: number; readonly y?: number; readonly yaw?: number }
/** Existing terrain, walkable floors and model anchors lent to a quest placement resolver. */
export interface QuestPlacementPorts {
  readonly terrain: (x: number, z: number) => number;
  readonly platforms?: readonly ((x: number, z: number) => number | undefined)[];
  readonly registry?: { readonly floorAt: (x: number, z: number) => number | undefined };
  /** Strict height difference above the current floor; omitted accepts any higher registered floor. */
  readonly registryReach?: number;
  readonly frames?: Readonly<Record<string, { readonly x: number; readonly z: number; readonly rot: number }>>;
  readonly pois?: Readonly<Record<string, object | null>>;
}
const questNumber = (value: number): number => {
  if (!Number.isFinite(value) || Math.abs(value) > 1000000) throw new RangeError('Invalid quest placement coordinate');
  return value;
};
const questKey = (value: string): string => {
  if (value.length === 0 || value.length > 256 || value.split('.').some(key => key === '__proto__' || key === 'prototype' || key === 'constructor')) throw new Error('Invalid quest anchor path');
  return value;
};
function questAnchor(raw: unknown): QuestPlaceAnchor {
  if (typeof raw !== 'object' || raw === null || !('x' in raw) || !('z' in raw) || typeof raw.x !== 'number' || typeof raw.z !== 'number') throw new Error('Invalid borrowed quest anchor');
  const y = 'y' in raw ? raw.y : undefined, yaw = 'yaw' in raw ? raw.yaw : undefined;
  if ((y !== undefined && typeof y !== 'number') || (yaw !== undefined && typeof yaw !== 'number')) throw new Error('Invalid quest anchor height or yaw');
  return { x: questNumber(raw.x), z: questNumber(raw.z), ...(y === undefined ? {} : { y: questNumber(y) }), ...(yaw === undefined ? {} : { yaw: questNumber(yaw) }) };
}
/** Resolve bounded quest placements in their authored frames, with live borrowed floors.
 * Explicit quest anchors precede model anchors; the former ignore dy, while model
 * anchors add dy only when their height is omitted. No prompt, registry or save is owned.
 */
export function createQuestPlacements(ports: QuestPlacementPorts): {
  readonly floorAt: (x: number, z: number) => number;
  readonly place: (at: QuestPlace) => { x: number; y: number; z: number; yaw: number };
  readonly setAnchor: (name: string, anchor: QuestPlaceAnchor) => void;
  /** Borrow current validated anchors without introducing a second placement owner. */
  readonly anchors: ReadonlyMap<string, Readonly<QuestPlaceAnchor>>;
} {
  if (ports.registryReach !== undefined && (!Number.isFinite(ports.registryReach) || ports.registryReach <= 0)) throw new RangeError('Invalid quest registry reach');
  if ((ports.platforms?.length ?? 0) > 4096) throw new RangeError('Too many quest floors');
  if (Object.keys(ports.frames ?? {}).length > 4096) throw new RangeError('Too many quest frames');
  for (const [id, frame] of Object.entries(ports.frames ?? {})) { questKey(id); questNumber(frame.x); questNumber(frame.z); questNumber(frame.rot); }
  const own = new Map<string, QuestPlaceAnchor>();
  const floorAt = (x: number, z: number): number => {
    questNumber(x); questNumber(z);
    let y = questNumber(ports.terrain(x, z));
    for (const floor of ports.platforms ?? []) { const f = floor(x, z); if (f !== undefined && questNumber(f) > y) y = f; }
    const registered = ports.registry?.floorAt(x, z);
    if (registered !== undefined && questNumber(registered) > y && (ports.registryReach === undefined || registered - y < ports.registryReach)) y = registered;
    return y;
  };
  return {
    anchors: own, floorAt,
    setAnchor: (name, anchor) => {
      questKey(name);
      if (!own.has(name) && own.size >= 4096) throw new RangeError('Too many quest anchors');
      own.set(name, questAnchor(anchor));
    },
    place: p => {
      questKey(p.poi); questNumber(p.x); questNumber(p.z);
      const dy = p.dy === undefined ? 0 : questNumber(p.dy);
      if (p.anchor !== undefined) {
        questKey(p.anchor);
        const override = own.get(p.anchor);
        if (override !== undefined) return { x: override.x, z: override.z, y: override.y ?? floorAt(override.x, override.z), yaw: override.yaw ?? 0 };
        const [poi, name] = p.anchor.split('.');
        const model: unknown = poi === undefined ? undefined : Reflect.get(ports.pois ?? {}, poi);
        if (name !== undefined && typeof model === 'object' && model !== null && 'anchors' in model && typeof model.anchors === 'object' && model.anchors !== null && Object.hasOwn(model.anchors, name)) {
          const a = questAnchor(Reflect.get(model.anchors, name));
          return { x: a.x, z: a.z, y: a.y ?? floorAt(a.x, a.z) + dy, yaw: a.yaw ?? 0 };
        }
      }
      let x = p.x, z = p.z, yaw = p.yaw === undefined ? 0 : questNumber(p.yaw);
      if (p.poi !== 'world') {
        const frame = Object.hasOwn(ports.frames ?? {}, p.poi) ? ports.frames?.[p.poi] : undefined;
        if (frame === undefined) throw new Error(`Missing quest frame ${p.poi}`);
        const c = Math.cos(frame.rot), sin = Math.sin(frame.rot);
        x = frame.x + p.x * c + p.z * sin; z = frame.z - p.x * sin + p.z * c; yaw += frame.rot;
      }
      return { x: questNumber(x), z: questNumber(z), y: p.y === undefined ? floorAt(x, z) + dy : questNumber(p.y), yaw };
    },
  };
}

export interface Cond { all?: string[]; any?: string[]; none?: string[] }

/** what a chest hands out */
export type ChestItem =
  | { item: string; n?: number }
  | { key: string; label: string }
  | { flag: string; label: string };

interface Base {
  /** unique within the table, persisted (flags are named after it) */
  id: string;
  at: Place;
  /** the E action is refused (the prompt shows `lockedLabel`) until this holds */
  requires?: Cond;
  lockedLabel?: string;
  /** the row is not there at all (no mesh, no prompt, no collider) until this holds */
  showWhen?: Cond;
  /** extra flags raised when the row fires (with its automatic flag) */
  sets?: string[];
  /** a toast when it fires */
  toast?: string;
  /** "[E]" reach in metres from the eye (default 2.5) — short for a dive treasure, so it has to be swum down to */
  reach?: number;
}

export interface ChestDef extends Base { kind: 'chest'; /** a key id; the chest is locked without `key:<lock>` */ lock?: string; contents: ChestItem[]; /** 'crate' (plain) | 'chest' (banded) | 'strongbox' (iron, small) */ look?: 'chest' | 'strongbox' | 'treasure' }
export interface KeyDef extends Base { kind: 'key'; key: string; label: string }
export interface DoorDef extends Base {
  kind: 'door';
  /** clear opening, metres */
  w: number; h: number;
  look: 'plank' | 'grate' | 'sluice';
  lock?: string;
  /** opens by itself while this holds (plates / levers); closes again when it stops holding unless `latch` */
  opensWhen?: Cond;
  latch?: boolean;
}
export interface LeverDef extends Base { kind: 'lever'; label?: string; /** once pulled it stays pulled (a puzzle step that is done) */ latch?: boolean }
export interface PlateDef extends Base { kind: 'plate'; /** square side, metres */ size: number; by: 'player' | 'barrel' | 'any' }
export interface BarrelDef extends Base { kind: 'barrel'; /** the barrel is returned here if it strays further than this (m) from its start */ leash: number }
interface PickupDef extends Base {
  kind: 'pickup';
  /** a registered pickup look's id (registerPickupLook: the kit's flint, coin, resin, token…) */
  look: string;
  /** an inventory item id to add (Inventory.ts ItemId) */
  item?: string;
  label: string;
  /** walk into it (feet within 1.1 m) instead of pressing E */
  touch?: boolean;
  /** tint for the glow looks (hex) */
  color?: string;
}
export interface BeaconDef extends Base { kind: 'beacon'; label: string }
export interface BenchDef extends Base { kind: 'bench'; label: string }
export interface AltarDef extends Base { kind: 'altar'; label: string; /** how many sockets to draw; socket i is filled while `fills[i]` is set */ fills: string[]; /** the pickup look that fills a socket */ socketLook: string }

export type InteractDef = ChestDef | KeyDef | DoorDef | LeverDef | PlateDef | BarrelDef | PickupDef | BeaconDef | BenchDef | AltarDef;

export interface InteractTable {
  /** flags raised outside the table (quest dialogue, enemy deaths) that rows may read */
  external: string[];
  rows: InteractDef[];
}

/** An authored world-space rest placement. Prompts and laws stay in the table. */
export interface InteractPlacement {
  readonly id: string; readonly kind: string; readonly x: number; readonly y: number; readonly z: number; readonly yaw: number;
}
/** Admit bounded finite placement rows before geometry, registry or prompt effects. */
export function readInteractPlacements(input: unknown): readonly InteractPlacement[] {
  if (!Array.isArray(input) || input.length > 4096) throw new Error('Invalid interactable placement rows');
  const ids = new Set<string>();
  return input.map((raw: unknown): InteractPlacement => {
    if (typeof raw !== 'object' || raw === null || !('id' in raw) || !('kind' in raw) || !('x' in raw) || !('y' in raw) || !('z' in raw) || !('yaw' in raw)) throw new Error('Invalid interactable placement');
    const { id, kind, x, y, z, yaw } = raw;
    if (typeof id !== 'string' || id.length === 0 || id.length > 256 || ids.has(id) ||
      typeof kind !== 'string' || kind.length === 0 || kind.length > 64 || typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number' || typeof yaw !== 'number' ||
      ![x, y, z, yaw].every(Number.isFinite) || Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) > 1000000 || Math.abs(yaw) > 1000000) throw new Error('Invalid or duplicate interactable placement');
    ids.add(id); return { id, kind, x, y, z, yaw };
  });
}
/** Bind each authored rest placement to the same table row, in original order.
 * Missing, foreign or mismatched rows refuse before a table can build. Moving
 * keys and barrel/body state retain their existing runtime owners afterward.
 */
export function bindInteractPlacements(table: InteractTable, input: unknown): InteractTable {
  const placements = new Map(readInteractPlacements(input).map(row => [row.id, row]));
  if (placements.size !== table.rows.length || new Set(table.rows.map(row => row.id)).size !== table.rows.length) throw new Error('Incomplete interactable placements');
  const rows = table.rows.map(row => {
    const at = placements.get(row.id);
    if (at === undefined || at.kind !== row.kind) throw new Error(`Unknown interactable placement ${row.id}`);
    return { ...row, at: { poi: 'world' as const, x: at.x, y: at.y, z: at.z, yaw: at.yaw } };
  });
  return { ...table, rows };
}

/** the automatic flag each kind raises when it fires */
export function autoFlag(d: InteractDef): string | null {
  switch (d.kind) {
    case 'chest': case 'door': return `open:${d.id}`;
    case 'key': case 'pickup': return `taken:${d.id}`;
    case 'lever': return `lever:${d.id}`;
    case 'plate': return `plate:${d.id}`;
    case 'beacon': return `lit:${d.id}`;
    case 'bench': case 'altar': return `used:${d.id}`;
    case 'barrel': return null;
    default: return null;
  }
}

/** every flag a row can raise: its automatic flag, `sets`, a key's `key:`, a chest's key / flag contents */
export function flagsRaised(d: InteractDef): string[] {
  const out: string[] = [];
  const a = autoFlag(d); if (a !== null) out.push(a);
  if (d.sets) out.push(...d.sets);
  if (d.kind === 'key') out.push(`key:${d.key}`);
  if (d.kind === 'chest') for (const l of d.contents) { if ('key' in l) out.push(`key:${l.key}`); else if ('flag' in l) out.push(l.flag); }
  return out;
}

/** every flag a row reads */
export function flagsRead(d: InteractDef): string[] {
  const out: string[] = [];
  const add = (c: Cond | undefined) => { if (c) out.push(...(c.all ?? []), ...(c.any ?? []), ...(c.none ?? [])); };
  add(d.requires); add(d.showWhen);
  if (d.kind === 'door') add(d.opensWhen);
  if (d.kind === 'altar') out.push(...d.fills);
  if ((d.kind === 'chest' || d.kind === 'door') && d.lock !== undefined) out.push(`key:${d.lock}`);
  return out;
}

/** flags that describe a moment, not progress — never persisted */
export const TRANSIENT_PREFIXES: string[] = ['plate:'];

/** Weak actions yield to another reachable prompt. */
/** `wireId`, when a server knows this prompt: what a client's press of it sends. */
export interface Interactable { position: Vector3; radius: number; label: string; onInteract: () => void; weak?: boolean; wireId?: string }

/** A pickup's look (E405: content registers its own — the game's specimen catalogue): its batched model, and the
 *  parts drawn up close, each on the lit or the glow batch, bobbing and spinning (`bob`: rest height, amplitude, spin) */
export interface PickupPart { key: string; batch: 'lit' | 'glow'; geometry: (seed: number) => BufferGeometry; bob?: readonly [number, number, number]; pulse?: number }
export interface PickupLook { model: ModelDef<Record<string, never>>; batch: 'lit' | 'glow'; lift: number; parts: readonly PickupPart[] }
const PICKUP_LOOKS = new Map<string, PickupLook>();
export function registerPickupLook(id: string, look: PickupLook): void { PICKUP_LOOKS.set(id, look); }
export function pickupLook(id: string): PickupLook | undefined { return PICKUP_LOOKS.get(id); }

/** the chest looks and door looks the runtime knows (InteractDef's `look`s) */
export type ChestLook = 'chest' | 'strongbox' | 'treasure';
export type DoorLook = 'plank' | 'grate' | 'sluice';
export interface ChestDims { w: number; d: number; h: number; lidH: number }
/**
 * The props the interaction runtime draws (E405 E417: the props are content, the game's — src/client/game/systems/props/interact.ts —
 * installed by the composition root; the engine keeps the runtime: the kinds, their poses, colliders and prompts).
 * Every part is a geometry in a local frame with its pivot at the origin; `models` are the catalog rows the runtime
 * places each kind's specimens as.
 */
export interface InteractProps {
  CHEST_DIMS: Readonly<Record<ChestLook, ChestDims>>;
  chestBase: (look: ChestLook, seed: number) => BufferGeometry;
  chestLid: (look: ChestLook, seed: number) => BufferGeometry;
  chestGlint: (look: ChestLook, seed: number) => BufferGeometry;
  padlock: (seed: number) => BufferGeometry;
  keyModel: (seed: number) => BufferGeometry;
  doorFrame: (look: DoorLook, w: number, h: number, seed: number) => BufferGeometry;
  doorPanel: (look: DoorLook, w: number, h: number, seed: number) => BufferGeometry;
  leverBase: (seed: number) => BufferGeometry;
  leverHandle: (seed: number) => BufferGeometry;
  plateRim: (size: number, seed: number) => BufferGeometry;
  plateSlab: (size: number, seed: number) => BufferGeometry;
  barrel: (seed: number) => BufferGeometry;
  brazier: (seed: number) => BufferGeometry;
  flame: (seed: number) => BufferGeometry;
  bench: (seed: number) => BufferGeometry;
  altar: (n: number, seed: number) => BufferGeometry;
  altarSocket: (i: number, n: number) => { x: number; y: number; z: number };
  models: {
    seaChest: ModelDef<{ readonly look: ChestLook; readonly locked: boolean }>;
    holdKey: ModelDef<Record<string, never>>;
    door: ModelDef<{ readonly look: DoorLook; readonly w: number; readonly h: number }>;
    lever: ModelDef<Record<string, never>>;
    pressurePlate: ModelDef<{ readonly size: number }>;
    puzzleBarrel: ModelDef<Record<string, never>>;
    beacon: ModelDef<Record<string, never>>;
    bench: ModelDef<Record<string, never>>;
    shardAltar: ModelDef<{ readonly sockets: number }>;
  };
}
let PROPS: InteractProps | null = null;
export function registerInteractProps(props: InteractProps): void { PROPS = props; }
export function interactProps(): InteractProps {
  if (PROPS === null) throw new Error('Interactables: no props installed (the composition root installs the kit\'s: installKitProps)');
  return PROPS;
}
