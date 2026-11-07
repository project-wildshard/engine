import { melee } from './blocks/melee';
import type { Actor, CombatPipeline, DamageDealt } from './pipeline';
import type { TargetAnimal } from '../../../client/engine/combat/types';
import type { Move } from '../../../client/engine/combat/view/melee';
import { Weapon } from './Weapon';
import type { Vector3, Quaternion } from 'three';

import type { MeleeProfile } from './meleeProfile';

interface ContactTarget extends TargetAnimal { combatActor?: () => Actor }
const adapters = new WeakMap<TargetAnimal, Actor>();
/** Native creatures expose their pipeline actor; custom practice targets keep their own damage behavior. */
export function meleeActor(target: ContactTarget): Actor {
  if (target.combatActor) return target.combatActor();
  const cached = adapters.get(target);
  if (cached) return cached;
  const actor: Actor = {
    id: `target.${target.kind}`, tags: ['actor.creature', `creature.${target.kind}`], state: [],
    attributes: { health: Infinity, maxHealth: Infinity },
    get alive() { return target.alive; },
    applyDamage: (req) => target.applyDamage(req.amount, req.point, req.dir),
  };
  adapters.set(target, actor); return actor;
}

/** Shared contact family. Swept blades and the spear retain distinct clocks and viewmodel strategies. */
export abstract class Melee<P extends MeleeProfile = MeleeProfile> extends Weapon {
  protected readonly profile: P;
  private readonly combat: CombatPipeline;
  constructor(profile: P, combat: CombatPipeline) {
    super(profile); this.profile = profile; this.combat = combat;
    this.attributes['damage'] = profile.damage; this.attributes['heavyDamageMul'] = 1;
    this.blocks.melee = melee(combat);
  }
  protected contact(target: TargetAnimal, amount: number, point: Vector3, dir: Vector3, from: Vector3,
    moveId: string, coverChecked = false): DamageDealt | null {
    return this.combat.hit({ source: 'env', sourceTags: ['actor.player', this.row.id, 'dmg.melee',
      ...(coverChecked ? ['cover.checked' as const] : [])], target: meleeActor(target), amount,
      point, dir, from, weaponId: this.row.id, moveId });
  }
  protected onSwingStart(_move: Move): void { /* Rung-2 weapons add a behavior at the same input edge. */ }
  protected onMoveHit(_move: Move, _killed: boolean): void { /* Optional subclass bookkeeping. */ }
  protected pickMove(_input: 'attack' | 'heavy'): Move | null { return null; }
  protected moveDamage(move: Move): number { return (this.attributes['damage'] ?? this.profile.damage) * move.damage; }
  protected poseExtra(_pos: Vector3, _q: Quaternion, _dt: number): void { /* Optional extra weapon pose. */ }
}
