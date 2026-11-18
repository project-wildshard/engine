// ONE-FORMAT CC31: part hp. Three hits on a 30-hp plate break it once; later hits pass to the volume behind it.
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { Events } from '@wildshard/engine/events/events';
import { Scope } from '@wildshard/engine/app/scope';
import { CombatPipeline, type Actor } from '@wildshard/engine/combat/pipeline';
import type { CreatureVolumePose } from '@wildshard/engine/physics/creatureVolumes';
import { createNativeTargetQueries, type NativeTargetBody } from '../plugin/simulation';
import { PartHealth } from '../../../shared/game/shardfile/partHealth';

/** A mech's front: an armour plate (x0) half a metre in front of its body ball. */
const inner: CreatureVolumePose = {
  volumes: [{ part: 'plate', multiplier: 0, radius: 0.5, halfLength: 0 }, { part: 'body', multiplier: 1, radius: 0.5, halfLength: 0 }],
  segment: (index, rear, front) => { rear.set(0, 1, index === 0 ? 1 : 0); front.copy(rear); },
};

function rig(): { parts: PartHealth; actor: Actor & { attributes: { health: number; maxHealth: number } }; combat: CombatPipeline; events: Events; scope: Scope } {
  const events = new Events(), scope = new Scope('part hp'), combat = new CombatPipeline(events, scope);
  const actor = { id: 'mech', tags: ['actor.creature'] as const, state: [] as const, attributes: { health: 100, maxHealth: 100 }, alive: true,
    applyDamage(req: { amount: number }): boolean { this.attributes.health -= req.amount; return false; } };
  const parts = new PartHealth(inner, new Map([['plate', 30]]), actor, combat, events, scope);
  return { parts, actor, combat, events, scope };
}

test('three hits on a 30-hp plate break it once, and the fourth hits the body behind it', () => {
  const { parts, actor, combat, events, scope } = rig();
  const broken: string[] = [];
  events.on('creature.part-broken', ({ part }) => { broken.push(part); }, scope);
  const settle = (): void => { events.flush('fixed.post'); };
  const body: NativeTargetBody = { alive: true, scale: 1, position: new Vector3(), hitVolumes: parts.pose, headWorld: out => out, bodyCapsule: () => undefined,
    dims: { headRadius: 0.3, bodyRadius: 0.3, bodyHalfLen: 0.5, bodyY: 0.5 } };
  const queries = createNativeTargetQueries<NativeTargetBody>();
  const shot = (): string | undefined => {
    const hit = queries.ray([body], new Vector3(0, 1, 10), new Vector3(0, 0, -1), 20);
    if (hit === null) return undefined;
    combat.hit({ source: 'env', sourceTags: [], target: actor, amount: 10, point: hit.point, dir: new Vector3(0, 0, -1),
      ...(hit.part === undefined ? {} : { part: hit.part }), ...(hit.multiplier === undefined ? {} : { partMultiplier: hit.multiplier }) });
    return hit.part;
  };
  expect([shot(), shot()]).toEqual(['plate', 'plate']);
  expect(parts.remaining('plate')).toBe(10);
  settle(); expect(broken).toEqual([]);
  expect(shot()).toBe('plate');
  settle(); expect(broken).toEqual(['plate']);
  // the plate took no body damage (x0); the body behind it takes the next hit
  expect(actor.attributes.health).toBe(100);
  expect(shot()).toBe('body');
  expect(actor.attributes.health).toBe(90);
  settle(); expect(broken).toEqual(['plate']);
});

test('part hp is saved state and names a real volume', () => {
  const { parts } = rig(), copy = rig();
  copy.parts.restore([12]);
  expect(copy.parts.remaining('plate')).toBe(12);
  expect(parts.snapshot()).toEqual([30]);
  expect(() => { copy.parts.restore([31]); }).toThrow('Incompatible part hp continuation');
  const events = new Events(), scope = new Scope('part hp');
  expect(() => new PartHealth(inner, new Map([['wing', 5]]), copy.actor, copy.combat, events, scope)).toThrow('Part hp names no volume wing');
});
