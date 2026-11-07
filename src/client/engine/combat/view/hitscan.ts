import * as THREE from 'three';
import { gameplayRandom } from '../../app/runtime';
import { worldHit } from './ranged';
import { impactSurfaceOf } from '../../../../shared/engine/combat/impact';
import { sstep } from '../../player/viewmodelTextures';
import type { Targets, TargetHit } from '../types';
import type { ImpactSurface } from '../../../../shared/engine/combat/Weapon';
import { instantSpreadDegrees, shotSpread } from '../../../../shared/engine/combat/shotSpread';

export interface HitscanProfile { range: number; damageScale: number; spreadAds: number; spreadHip: number; spreadRadius: 'linear' | 'sqrt'; movingSpread: number; movingAimReduction: number }
export interface HitscanResult { point: THREE.Vector3; direction: THREE.Vector3; surface: ImpactSurface | null; hit: TargetHit | null; killed: boolean }
const origin = new THREE.Vector3(), direction = new THREE.Vector3(), transverse = new THREE.Vector3(), end = new THREE.Vector3();
export function hitscan(aim: (origin: THREE.Vector3, direction: THREE.Vector3) => THREE.Vector3, targets: Targets | undefined,
  profile: HitscanProfile, adsBlend: number, bloom: number, speedFactor: number, draws: (world: () => number) => () => number = world => world): HitscanResult {
  aim(origin, direction);
  const a = sstep(0, 1, adsBlend);
  const spread = THREE.MathUtils.degToRad(instantSpreadDegrees(profile.spreadAds, profile.spreadHip, a, bloom,
    speedFactor, profile.movingSpread, profile.movingAimReduction));
  shotSpread(direction, spread, draws(gameplayRandom), { radius: profile.spreadRadius, axisScale: 1 }, transverse);
  let dist = profile.range, surface: ImpactSurface | null = null;
  const wall = worldHit(origin, end.copy(origin).addScaledVector(direction, profile.range), 0);
  if (wall) { dist = wall.distance; surface = impactSurfaceOf(wall.material); }
  const hit = targets?.raycast(origin, direction, dist) ?? null;
  if (hit) { dist = hit.distance; surface = 'flesh'; }
  const point = end.copy(origin).addScaledVector(direction, dist);
  let killed = false;
  if (surface === 'flesh' && hit) { point.copy(hit.point); killed = hit.animal.applyDamage(hit.animal.damageFor(hit.headshot, hit.distance) * profile.damageScale, hit.point, direction); }
  return { point, direction, surface, hit, killed };
}
