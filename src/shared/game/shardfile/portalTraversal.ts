import type { CharacterMotor } from '@wildshard/engine/physics/CharacterMotor';
import type { Physics } from '@wildshard/engine/physics/Physics';
import { canStandAt } from '@wildshard/engine/physics/query';
import { portalLinkRules, type PortalLinkEntry } from '@wildshard/format/portalLinkAssets';
import { parsePortalLink, type PortalLink } from '@wildshard/format/portalLink';

const transitioning = new WeakSet<Physics>();
/** Checkpoint owners refuse every write while a portal is validating or committing a transfer in this physics world. */
export function portalTransitioning(physics: Physics): boolean { return transitioning.has(physics); }
/** Existing player/capsule ports; a transfer cannot allocate a second player or physics world. */
export interface PortalTraversalPorts {
  physics: Physics; motor: CharacterMotor; feet: { x: number; y: number; z: number };
  waterAt?: (x: number, z: number) => number | null;
}
/** One synchronous, source-bound teleport, yielding the admitted heading for the normal camera/player owner. */
export interface PortalTransfer { from: string; to: string; yaw: number }
/** A reusable normal-client and admission operation; static floor and capsule clearance are rechecked on every transfer. */
export function createPortalTraversal(entries: readonly PortalLinkEntry[], source: Parameters<typeof portalLinkRules>[1], ports: PortalTraversalPorts): { teleport: (from: string) => PortalTransfer } {
  const errors = portalLinkRules(entries, source); if (errors.length > 0) throw new Error(errors.join('; '));
  type Node = PortalLink['road'];
  const nodes = new Map<string, Node>(), links = new Map<string, string>();
  for (const entry of entries) {
    const portal = parsePortalLink(entry.portal);
    for (const node of [portal.road, portal.destination, portal.exit]) nodes.set(node.id, node);
    for (const link of portal.links) links.set(link.from, link.to);
  }
  const dry = (point: { x: number; y: number; z: number }): boolean => {
    const water = ports.waterAt?.(point.x, point.z); return water === undefined || water === null || water <= point.y + 0.15;
  };
  return { teleport: from => {
    if (transitioning.has(ports.physics)) throw new Error('Portal transfer already in progress');
    const origin = nodes.get(from), to = links.get(from), destination = to === undefined ? undefined : nodes.get(to);
    if (origin === undefined || destination === undefined || to === undefined) throw new Error('Unknown or unbound portal link');
    transitioning.add(ports.physics);
    try {
      const { feet, motor, physics } = ports;
      // The real controller rests on its skin above a floor; admission queries use the declared feet-level surface.
      const sourcePose = { x: feet.x, y: origin.at[1], z: feet.z };
      if (Math.hypot(feet.x - origin.at[0], feet.y - origin.at[1], feet.z - origin.at[2]) > 1.25
        || Math.abs(feet.y - origin.at[1]) > 0.15
        || !canStandAt(physics, sourcePose, motor.opts, origin.floor, motor.collider) || !dry(feet)) throw new Error('Player is not standing at the bound source portal');
      const point = { x: destination.at[0], y: destination.at[1], z: destination.at[2] };
      if (!canStandAt(physics, point, motor.opts, destination.floor, motor.collider) || !dry(point)) throw new Error('Portal destination lacks static floor or capsule clearance');
      // Validation completes before the existing capsule/feet change; no await or author code can save an intermediate pose.
      motor.resetAt(point); Object.assign(feet, point);
      return { from, to, yaw: destination.yaw };
    } finally { transitioning.delete(ports.physics); }
  } };
}
