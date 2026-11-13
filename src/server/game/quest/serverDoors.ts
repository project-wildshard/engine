/** The doors a page used to swing alone: a building's leaf stands in the server's world, so a server keeps it, shut or open, and a page
 *  draws what it says. A door is the world's and everyone sees it; a door's bar is each player's own (J106). State is a world flag, so a
 *  save and a room carry it with no new shape, and `buildingDoor.ts` is the page's own law, on the server's clock. */
import * as v from 'valibot';
import type { SimHost } from '@wildshard/engine/sim';
import { test } from '@wildshard/engine/world/interact/flags';
import { questBooks } from '@wildshard/engine/quest/players';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { tagOf } from '@wildshard/engine/physics/surface';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { buildingDoor, buildingDoorCollides, buildingDoorFlag, buildingDoorYaw, stepBuildingDoor, toggleBuildingDoor, type BuildingDoorState } from '../../../shared/game/shardfile/buildingDoor';
import { QuestFlagGates } from '../../../shared/game/quest/flagGates';

const PIECES = 'data/physics.generated.json', FOREST = 'world/forest-page.json', COMPOSITION = 'quests/page-composition.json';
/** How far a press reaches a door, past the page's own reach: the server has the body a command behind. */
const DOOR_REACH = 3.4;
const finite = v.pipe(v.number(), v.finite());
const Pieces = v.object({ pieces: v.array(v.object({ id: v.string(), category: v.string(), follows: v.exactOptional(v.object({ matrix: v.pipe(v.array(finite), v.length(16)), rotation: v.exactOptional(v.boolean()) })) })) });
const Forest = v.object({ buildings: v.exactOptional(v.object({ life: v.object({ door: v.object({ seconds: finite, angle: finite, collision: v.exactOptional(v.object({ rearmRadius: finite })) }) }) })) });
const Composition = v.object({ door: v.exactOptional(v.object({ door: v.string(), gates: v.object({ gates: v.array(v.object({ id: v.string(), opensWhen: v.unknown(), target: v.object({ kind: v.literal('piece'), piece: v.string() }) })) }) })) });

type Collider = ReturnType<SimHost['physics']['world']['getCollider']>;
interface Quat { readonly x: number; readonly y: number; readonly z: number; readonly w: number }
interface Point { readonly x: number; readonly y: number; readonly z: number }
const times = (a: Quat, b: Quat): Quat => ({ x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y, y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x, z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w, w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z });
const yawOf = (yaw: number): Quat => ({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
const conjugate = (q: Quat): Quat => ({ x: -q.x, y: -q.y, z: -q.z, w: q.w });
const turned = (q: Quat, p: Point): Point => times(times(q, { ...p, w: 0 }), conjugate(q));
interface Leaf { readonly door: BuildingDoorState; readonly flag: string; readonly collider: Collider; readonly hinge: Point; readonly rotation: Quat; readonly local: Point; readonly bars: readonly { readonly opensWhen: Parameters<typeof test>[1] }[] }

/** The flags a condition reads. */
const flagsOf = (condition: Parameters<typeof test>[1]): readonly string[] => [...condition?.all ?? [], ...condition?.any ?? [], ...condition?.none ?? []];
/** Every collider that names a piece, by its id. */
function pieceColliders(host: SimHost): ReadonlyMap<string, Collider> {
  const found = new Map<string, Collider>();
  host.physics.world.forEachCollider(collider => {
    const owner = tagOf(collider)?.owner;
    if (typeof owner !== 'object' || owner === null) return;
    for (const id of Object.values(owner)) if (typeof id === 'string' && id.startsWith('piece:')) found.set(id.slice('piece:'.length), collider);
  });
  return found;
}

/** Keep the building doors of a shard that has them. False when it has none. `opened`: what a page's save left open, for a world's first boot.
 *  `restored`: a world restored from its save, whose leaves already stand where the save put them. */
export async function installServerDoors(host: SimHost, product: ShardProduct | undefined, opened: ReadonlySet<string> = new Set(), restored = false): Promise<boolean> {
  if (product === undefined || !product.hasFile(PIECES) || !product.hasFile(FOREST)) return false;
  const [piecesInput, forestInput, compositionInput] = await Promise.all([product.json<unknown>(PIECES), product.json<unknown>(FOREST), product.hasFile(COMPOSITION) ? product.json<unknown>(COMPOSITION) : null]);
  const look = v.parse(Forest, forestInput).buildings?.life.door, composition = compositionInput === null ? undefined : v.parse(Composition, compositionInput).door;
  if (look === undefined) return false;
  const colliders = pieceColliders(host), rows = v.parse(Pieces, piecesInput).pieces, bar = (id: string): string => `${id}-bar`, rearm = look.collision?.rearmRadius ?? 0;
  const bars = composition?.gates.gates ?? [], books = questBooks(host), routes = actRoutes(host), leaves: Leaf[] = [];
  for (const row of rows) {
    const collider = colliders.get(row.id), matrix = row.follows?.matrix;
    if (row.category !== 'buildings' || row.follows?.rotation !== true || matrix === undefined || collider === undefined || rows.some(other => other.id === row.id.replace(/-bar$/u, '') && other.id !== row.id)) continue;
    const door = buildingDoor(row.id), flag = buildingDoorFlag(row.id);
    if (opened.has(row.id)) host.flags.set(flag);
    door.open = host.flags.has(flag); door.t = door.open ? 1 : 0;
    // A fresh world's leaf stands shut, as baked. A restored one stands where its save put it (open, if its flag is), so its
    // shut pose is that one turned back.
    const hinge = { x: matrix[12] ?? 0, y: matrix[13] ?? 0, z: matrix[14] ?? 0 }, standing = collider.rotation(), at = collider.translation();
    const rotation = restored ? times(standing, yawOf(-buildingDoorYaw(door.t, look.angle))) : standing;
    const local = turned(conjugate(standing), { x: at.x - hinge.x, y: at.y - hinge.y, z: at.z - hinge.z });
    leaves.push({ door, flag, collider, hinge, rotation, local, bars: bars.filter(gate => gate.target.piece === row.id).map(gate => gate as { readonly opensWhen: Parameters<typeof test>[1] }) });
  }
  if (leaves.length === 0) return false;
  books.show(leaves.map(leaf => leaf.flag));
  const pose = (leaf: Leaf): void => {
    const q = times(leaf.rotation, yawOf(buildingDoorYaw(leaf.door.t, look.angle))), at = turned(q, leaf.local);
    leaf.collider.setRotation(q); leaf.collider.setTranslation({ x: leaf.hinge.x + at.x, y: leaf.hinge.y + at.y, z: leaf.hinge.z + at.z });
  };
  for (const leaf of leaves) {
    // A restored leaf is left where it stands: posing it again moves it by a rounding error and re-files it in the broad
    // phase, so the resumed world's physics would no longer match the world that never stopped (HS1).
    if (!restored) pose(leaf);
    routes.claims.set(leaf.door.id, player => {
      const body = host.players.get(player);
      if (body === undefined || Math.hypot(body.position.x - leaf.hinge.x, body.position.z - leaf.hinge.z) > DOOR_REACH + Math.hypot(leaf.local.x, leaf.local.z)) return;
      const flags = books.of(player).flags;
      if (leaf.bars.some(gate => !test(flags, gate.opensWhen))) return;
      if (toggleBuildingDoor(leaf.door)) host.flags.set(leaf.flag); else host.flags.clear(leaf.flag);
    });
  }
  books.claim(leaves.flatMap(leaf => leaf.bars.flatMap(gate => flagsOf(gate.opensWhen)))); // J106: what opens a bar is each player's own
  const gates = bars.length === 0 ? null : new QuestFlagGates(host, { gates: bars }, false, undefined, id => colliders.get(bar(id)) ?? null);
  host.onStep('world.doors', dt => {
    gates?.sync();
    for (const leaf of leaves) {
      if (stepBuildingDoor(leaf.door, dt, look.seconds)) pose(leaf);
      const collides = buildingDoorCollides(leaf.door, () => [...host.players.values()].every(player => Math.hypot(player.position.x - leaf.hinge.x, player.position.y - leaf.hinge.y, player.position.z - leaf.hinge.z) > rearm));
      if (leaf.collider.isEnabled() !== collides) leaf.collider.setEnabled(collides);
    }
  });
  return true;
}
