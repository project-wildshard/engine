// ONE-FORMAT OF37b (Q-S10: a separate patrol primitive; shard-format OF37a). A `creatures.patrols` row walks its members
// round its route at its speed, in step: each member keeps its place in the line (its spawn offset from the line's middle)
// about the stop the patrol walks to, and the patrol takes the next stop once its middle reaches this one, round and
// round. A living player within `engage` metres of any living member draws the whole patrol into the fight: each member
// runs at the nearest living player and strikes in reach. Once every living member is more than `leash` metres from the
// route it gives up, walks back to where it left the route (no player draws it while it does), and walks on from there.
// The patrol owns its members' motion; the mode, the next stop and where it left are the host's state (one adapter per
// patrol, installed only when a row declares one, so older saves restore).
import * as v from 'valibot';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';

type Patrol = NonNullable<Shardfile['creatures']['patrols']>[number];
interface Point { readonly x: number; readonly z: number }
const MODES = ['walk', 'fight', 'return'] as const;
const Saved = v.strictObject({ version: v.literal(1), mode: v.picklist(MODES), next: v.pipe(v.number(), v.integer(), v.minValue(0)), left: v.tuple([v.number(), v.number()]) });
/** Metres: a stop (or the point it left) counts as reached once the line's middle is this close. */
const REACHED = 1;
/** Metres: a member stops this close to its place, or to the player it fights. */
const CLOSE = 0.5, REACH = 1.5;
const TURN_RATE = 6;

/** Metres from `p` to the nearest point on the closed route. */
export function routeDistance(route: readonly (readonly [number, number, number])[], p: Point): number {
  let best = Infinity;
  for (let i = 0; i < route.length; i++) {
    const a = route[i], b = route[(i + 1) % route.length];
    if (a === undefined || b === undefined) continue;
    const dx = b[0] - a[0], dz = b[2] - a[2], length = dx * dx + dz * dz;
    const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.z - a[2]) * dz) / length));
    best = Math.min(best, Math.hypot(p.x - (a[0] + t * dx), p.z - (a[2] + t * dz)));
  }
  return best;
}

/** Install every declared patrol; returns how many (0: no adapter). */
export function installDeclaredPatrols(host: SimHost, patrols: readonly Patrol[], restoring = false): number {
  for (const patrol of patrols) {
    if (host.hasStep(`patrol.${patrol.id}`)) throw new Error(`Patrol ${patrol.id} is already installed`);
    for (const id of patrol.members) if (!host.entities.has(id)) throw new Error(`Patrol member ${id} names no body`);
  }
  for (const patrol of patrols) installPatrol(host, patrol, restoring);
  return patrols.length;
}

function installPatrol(host: SimHost, patrol: Patrol, restoring: boolean): void {
  const members = patrol.members.map(id => {
    const body = host.entities.get(id); if (body === undefined) throw new Error(`Patrol member ${id} names no body`);
    return body;
  });
  const middle = (): Point => {
    const living = members.filter(m => m.alive);
    const from = living.length === 0 ? members : living;
    return { x: from.reduce((s, m) => s + m.position.x, 0) / from.length, z: from.reduce((s, m) => s + m.position.z, 0) / from.length };
  };
  const start = middle();
  const offsets = members.map(m => ({ x: m.position.x - start.x, z: m.position.z - start.z }));
  let mode: (typeof MODES)[number] = 'walk', next = 0, left: Point = start;
  const stop = (index: number): Point => { const at = patrol.route[index % patrol.route.length]; return at === undefined ? start : { x: at[0], z: at[2] }; };
  /** Each living member heads for its place about `goal` at the patrol's speed. */
  const march = (goal: Point): void => {
    members.forEach((m, i) => {
      if (!m.alive) return;
      const offset = offsets[i] ?? { x: 0, z: 0 }, dx = goal.x + offset.x - m.position.x, dz = goal.z + offset.z - m.position.z;
      m.setMotion(Math.atan2(dx, dz), Math.hypot(dx, dz) > CLOSE ? patrol.speed : 0, TURN_RATE);
    });
  };
  const living = () => [...host.players.values()].filter(player => player.health.alive);
  const step = (): void => {
    if (!members.some(m => m.alive)) return;
    if (mode === 'walk' && living().some(player => members.some(m => m.alive && m.position.distanceTo(player.position) <= patrol.engage))) {
      mode = 'fight'; left = middle();
    }
    if (mode === 'fight') {
      if (members.every(m => !m.alive || routeDistance(patrol.route, m.position) > patrol.leash)) mode = 'return';
      else {
        for (const m of members) {
          if (!m.alive) continue;
          let foe = null, best = Infinity;
          for (const player of living()) { const d = m.position.distanceTo(player.position); if (d < best) { best = d; foe = player; } }
          if (foe === null) { m.setMotion(m.yaw, 0, TURN_RATE); continue; }
          m.setMotion(Math.atan2(foe.position.x - m.position.x, foe.position.z - m.position.z), best > REACH ? patrol.speed : 0, TURN_RATE);
          if (best <= REACH) host.startStrike(m.entityId, foe.id);
        }
        return;
      }
    }
    if (mode === 'return') {
      const at = middle();
      if (Math.hypot(at.x - left.x, at.z - left.z) <= REACHED) mode = 'walk';
      else { march(left); return; }
    }
    const at = middle(), goal = stop(next);
    if (Math.hypot(at.x - goal.x, at.z - goal.z) <= REACHED) next = (next + 1) % patrol.route.length;
    march(stop(next));
  };
  if (!restoring) march(stop(next));
  host.onStep(`patrol.${patrol.id}`, () => { step(); }, {
    snapshot: () => ({ version: 1, mode, next, left: [left.x, left.z] }),
    restore: (value) => {
      const saved = v.parse(Saved, value);
      if (saved.next >= patrol.route.length) throw new Error(`Incompatible patrol continuation: ${patrol.id}`);
      mode = saved.mode; next = saved.next; left = { x: saved.left[0], z: saved.left[1] };
    },
  });
}
