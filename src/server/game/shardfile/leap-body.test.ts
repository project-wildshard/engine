// ONE-FORMAT CC17b on a real ground body: ShardDecisions' order (the move places the body, then the bodies step).
import { expect, test } from 'vitest';
import { ActorMoveRunner } from '@wildshard/engine/ai/moves';
import { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { SIM_CREATURE_RECIPE } from '../../../test/game/creatureRecipe';

test('on a real ground body the leap owns its height while it flies (the ground follow would pull it down)', () => {
  const flight = (airborne: boolean): { peak: number; landed: number } => {
    const actor = new AnimalSim(SIM_CREATURE_RECIPE.spec, 1, 1, 'leaper', { heightAt: () => 0, random: () => 0.5 });
    actor.place(0, 0, 0);
    const move = new ActorMoveRunner({ id: 'a.leap', kind: 'leap', to: { kind: 'target' }, height: 9 }, actor);
    let peak = 0, done: boolean | undefined;
    for (let step = 0; step < 600 && done === undefined; step++) {
      // the order ShardDecisions keeps: the move places the body, then the bodies step
      const frame = move.step({ body: actor, target: { x: 0, y: 0, z: 12 } });
      if (frame.placement !== undefined) actor.place(frame.placement.x, frame.placement.z, frame.placement.yaw, frame.placement.y);
      actor.airborne = airborne && frame.placement !== undefined && frame.done === undefined;
      actor.step(1 / 60); peak = Math.max(peak, actor.position.y); done = frame.done;
    }
    return { peak, landed: actor.position.z };
  };
  const held = flight(true);
  expect(Math.abs(held.peak - 9)).toBeLessThanOrEqual(0.3);
  expect(Math.abs(held.landed - 12)).toBeLessThanOrEqual(0.3);
  expect(flight(false).peak).toBeLessThan(8.5);
});
