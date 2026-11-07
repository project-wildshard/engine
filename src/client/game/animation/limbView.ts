import type { RigAnimCtx, SpeciesDef } from '@wildshard/engine/entities/species/registry';
import * as v from 'valibot';
import { LimbRigSchema, parseLimbBlend } from '@wildshard/format/limbRig';
import { LimbAnimator } from '../../../shared/game/animation/limbBlend';
import { limbRest, newLimbPose, applyLimbPose } from '../../../shared/game/animation/limbRig';
import type { LimbQueryPose } from './limbQueryPose';

const queries = new WeakMap<RigAnimCtx['animal'], LimbQueryPose>();
/** Bind an already owned query; consumers supply no animation callback or shard hook. */
export function bindLimbQuery(animal: RigAnimCtx['animal'], query: LimbQueryPose): void {
  if (queries.has(animal)) throw new Error('Limb query already installed');
  queries.set(animal, query);
}
/** Remove only the binding belonging to this presentation owner. */
export function retireLimbQuery(animal: RigAnimCtx['animal'], query: LimbQueryPose): void {
  if (queries.get(animal) === query) queries.delete(animal);
}
/** Client-only animation on the existing animal clock, using admitted numeric rig/blend/clip rows. */
export function limbAnimation(input: unknown, blend: unknown, clips: unknown): NonNullable<SpeciesDef['animate']> {
  const spec = v.parse(LimbRigSchema, input);
  const animator = new LimbAnimator(parseLimbBlend(blend), clips, spec.spine.head), pose = newLimbPose();
  return c => {
    const rest = limbRest(spec, c.bones);
    animator.advance(c, rest, pose, c.animal.debugGait);
    applyLimbPose(spec, rest, pose);
    queries.get(c.animal)?.stage(pose);
  };
}
