import { expect, test } from 'vitest';
import { abilityTell } from '../src/client/game/shardfile/abilityTell';
import type { PageAbility } from '../src/client/game/shardfile/clientRecipes';

// ONE-FORMAT CC11b3: a declared ability's tell, from its row and the server's `abilityT`: a ring through a marked slam's
// wind-up, nothing for an unmarked bite.
const slam: PageAbility = { id: 'kit.slam', tell: 'ring', windup: 1.2, active: 0.2, recover: 0.6, reach: 1.6, width: 0 };
const bite: PageAbility = { id: 'kit.bite', windup: 0.3, active: 0.1, recover: 0.4, reach: 1.2, width: 0 };
const lane: PageAbility = { id: 'kit.charge', tell: 'lane', windup: 0.5, active: 0.5, recover: 0, reach: 8, width: 2 };

test('a marked slam shows a ring on the body through its wind-up, then its active window', () => {
  const half = abilityTell(slam, 0.6 / 2, 3, 4, 0);
  expect(half).toMatchObject({ tell: 'ring', phase: 'windup', windup: 1.2, radius: 1.6, x0: 3, z0: 4 });
  expect(half?.time).toBeCloseTo(0.6);
  expect(abilityTell(slam, 1.3 / 2, 3, 4, 0)?.phase).toBe('active');
  expect(abilityTell(slam, 1.9 / 2, 3, 4, 0)?.phase).toBe('done');
});

test('an unmarked bite shows no warning', () => {
  expect(abilityTell(bite, 0.1, 0, 0, 0)).toBeNull();
});

test('a lane runs its reach ahead of the body along its yaw', () => {
  const draw = abilityTell(lane, 0.1, 1, 2, Math.PI / 2);
  expect(draw).toMatchObject({ tell: 'lane', phase: 'windup', width: 2 });
  expect(draw?.x1).toBeCloseTo(9); expect(draw?.z1).toBeCloseTo(2);
});
