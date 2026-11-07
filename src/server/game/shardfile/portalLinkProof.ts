import { CharacterMotor } from '@wildshard/engine/physics/CharacterMotor';
import { tagOf } from '@wildshard/engine/physics/surface';
import { portalLinkRules, type PortalLinkEntry } from '@wildshard/format/portalLinkAssets';
import { validatePortalFloors } from '@wildshard/format/portalFloor';
import { createPortalTraversal, type PortalTraversalPorts } from '../../../shared/game/shardfile/portalTraversal';

/** Native road-lane and round-trip counts; only two declared links teleport, every other distance is walked. */
export interface PortalLinkProof { lanes: number; steps: number; transfers: number }
const options = { radius: 0.35, height: 1.8, step: 0.3, maxClimbDeg: 45, snap: 0.2, group: 'PLAYER', blockedBy: ['WORLD'] } as const;
/** Prove each full-width static deck, bound arrival, walked route, exit link and return to the road with the real capsule. */
export function provePortalLinks(entries: readonly PortalLinkEntry[], source: Parameters<typeof portalLinkRules>[1], assets: ReadonlyMap<string, Uint8Array>, ports: Pick<PortalTraversalPorts, 'physics' | 'waterAt'>): PortalLinkProof {
  const errors = portalLinkRules(entries, source); if (errors.length > 0) throw new Error(errors.join('; '));
  validatePortalFloors(entries, source, assets);
  const motor = new CharacterMotor(ports.physics, options), feet = { x: 0, y: 0, z: 0 };
  const traversal = createPortalTraversal(entries, source, { ...ports, motor, feet });
  const controlled = new Set([...source.targets?.panels.flatMap(row => row.colliders) ?? [], ...source.movers?.map(row => row.id) ?? []]);
  const floors = new Set([...source.props?.colliders.filter(row => row.initialActive && row.panel === null && !controlled.has(row.id)).map(row => row.id) ?? [],
    ...source.meshCollision?.tiles.map(row => `mesh.tile.${row.x}.${row.z}`).filter(id => !controlled.has(id)) ?? []]);
  let steps = 0, transfers = 0, lanes = 0, entrySteps = 0;
  const move = (dx = 0, dz = 0, floor?: string): void => {
    if (++entrySteps > 36000) throw new Error('Portal entry capsule proof work bound');
    const result = motor.move(feet, { x: dx, y: -9.81 / 3600, z: dz }); steps++;
    const owner = tagOf(result.groundCollider ?? motor.collider)?.owner, water = ports.waterAt?.(feet.x, feet.z);
    if (!result.grounded || result.groundNormalY < Math.cos(Math.PI / 4) || typeof owner !== 'string' || !floors.has(owner)
      || (floor !== undefined && owner !== floor)) throw new Error('Portal route lacks grounded named static collision');
    if (water !== undefined && water !== null && water > feet.y + 0.15) throw new Error('Submerged portal route');
  };
  const walk = (point: readonly [number, number, number], floor?: string): void => {
    let stalled = 0;
    while (Math.hypot(feet.x - point[0], feet.z - point[2]) > 0.04) {
      const dx = point[0] - feet.x, dz = point[2] - feet.z, before = Math.hypot(dx, dz), stride = Math.min(before, 0.1);
      move(dx / before * stride, dz / before * stride, floor);
      stalled = Math.hypot(feet.x - point[0], feet.z - point[2]) >= before - 0.02 ? stalled + 1 : 0;
      if (stalled >= 5) throw new Error('Blocked portal route');
    }
    if (Math.abs(feet.y - point[1]) > 0.15) throw new Error('Portal route misses declared walk height');
  };
  const reset = (point: readonly [number, number, number], floor: string): void => {
    Object.assign(feet, { x: point[0], y: point[1] + 0.05, z: point[2] }); motor.resetAt(feet);
    for (let tick = 0; tick < 5; tick++) move(0, 0, floor);
  };
  try {
    for (const entry of entries) {
      entrySteps = 0;
      const { portal, edge } = entry, vertical = edge === 'north' || edge === 'south', sign = edge === 'north' || edge === 'east' ? 1 : -1;
      // Overlapping capsule lanes cover the 8m opening and full 15m static deck, before either portal executes.
      for (let lane = 0; lane <= 22; lane++) {
        const cross = -3.65 + lane * 7.3 / 22;
        reset(vertical ? [cross, 0, sign * 249.6] : [sign * 249.6, 0, cross], portal.road.floor);
        walk(vertical ? [cross, 0, sign * 235.4] : [sign * 235.4, 0, cross], portal.road.floor);
        if (Math.abs((vertical ? feet.x : feet.z) - cross) > 0.35) throw new Error('Portal road lane drift');
        lanes++;
      }
      const road: [number, number, number] = vertical ? [0, 0, sign * 249.6] : [sign * 249.6, 0, 0];
      reset(road, portal.road.floor); walk(portal.road.at, portal.road.floor);
      const arrival = traversal.teleport(portal.road.id); transfers++;
      if (arrival.to !== portal.destination.id) throw new Error('Portal arrived at an unbound destination');
      move(0, 0, portal.destination.floor);
      for (const point of portal.route) walk(point);
      const exit = traversal.teleport(portal.exit.id); transfers++;
      if (exit.to !== portal.road.id) throw new Error('Portal exited to an unbound deck');
      move(0, 0, portal.road.floor); walk(road, portal.road.floor);
    }
    return { lanes, steps, transfers };
  } finally { motor.dispose(); }
}
