import * as THREE from 'three';
import { Player } from '../../client/engine/player/Player';
import type { SkyRig as Sky } from '../../client/engine/world/skyRig';
import type { Forest } from '../../client/engine/world/forest/Forest';
import type { CharacterMotor } from '../../shared/engine/physics/CharacterMotor';
import type { Collider } from '@dimforge/rapier3d-simd';
import { WorldRegistry } from '../../client/engine/world/registry';
import { FakeGame, legacyDouble } from '@wildshard/engine/test/FakeGame';

/** Query-only test double; THREE.Ray supplies box intersections, never a production collision path. */
export class FakePhysics {
  readonly boxes: readonly THREE.Box3[];
  constructor(boxes: readonly THREE.Box3[] = []) { this.boxes = boxes; }
  castRay(origin: THREE.Vector3, direction: THREE.Vector3, maxDist: number): { point: THREE.Vector3; distance: number } | null {
    const ray = new THREE.Ray(origin, direction), point = new THREE.Vector3();
    let nearest: { point: THREE.Vector3; distance: number } | null = null;
    for (const box of this.boxes) {
      if (box.containsPoint(origin)) return { point: origin.clone(), distance: 0 };
      if (ray.intersectBox(box, point) === null) continue;
      const distance = point.distanceTo(origin);
      if (distance <= maxDist && (nearest === null || distance < nearest.distance)) nearest = { point: point.clone(), distance };
    }
    return nearest;
  }
  lineOfSight(from: THREE.Vector3, to: THREE.Vector3, slack = 0.3): boolean {
    const direction = to.clone().sub(from), length = direction.length();
    if (length < 1e-6) return true;
    const hit = this.castRay(from, direction.divideScalar(length), length);
    return hit === null || hit.distance >= length - slack;
  }
}

export function fakeWorld(): {
  game: FakeGame; player: Player; sky: Sky; forest: Forest; registry: WorldRegistry; physics: FakePhysics;
} {
  const game = new FakeGame();
  // Cast only at the legacy constructor boundary: these doubles deliberately implement a small surface.
  const player: Player = legacyDouble<Player>({
    sampleAimCommand: () => Player.prototype.sampleAimCommand.call(player), inputService: null, crouching: false,
    position: new THREE.Vector3(), yaw: 0, pitch: 0, locked: true, fovKick: 0,
    sprinting: false, speedFactor: 0, bobTime: 0, dashing: false, swinging: false,
    motor: legacyDouble<CharacterMotor>({ collider: legacyDouble<Collider>({}) }), dashTo: (): boolean => false,
  });
  const sky = legacyDouble<Sky>({ sunDir: new THREE.Vector3(0, 1, 0), setupMaterial: (): void => undefined,
    csm: legacyDouble<Sky['csm']>({ lights: [], updateFrustums: (): void => undefined }) });
  const forest = legacyDouble<Forest>({ nearby: (): [] => [] });
  return { game, player, sky, forest, registry: new WorldRegistry(), physics: new FakePhysics() };
}
