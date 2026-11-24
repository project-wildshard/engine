import { afterEach, expect, test, vi } from 'vitest';
import { Vector3 } from 'three';
import * as reachQueries from '../src/shared/engine/ai/reach';
import { StrikeRunner } from '../src/shared/engine/ai/strikes';
import { strikeFromData } from '../src/shared/engine/ai/strikeRows';
import { patrolContactLands } from '../src/server/game/boss/patrolNative';
import { liveStrikeProfiles } from './fixtures/liveNalati';
import { parse, object } from 'valibot';
import { CreatureStrikeSchema } from '@wildshard/format/creatures';

const strikes = parse(object({arrow: CreatureStrikeSchema}), liveStrikeProfiles);
const arrow = strikes['arrow'];
if (arrow === undefined) throw new Error('Missing frozen arrow strike');

afterEach(() => { vi.restoreAllMocks(); });

test('a rider\'s arrow lands by its strike\'s range and origin, and never through cover', () => {
  const runner = new StrikeRunner(), strike = strikeFromData(arrow), player = new Vector3(1, 0, 2);
  const actor = { position: new Vector3(1, 0, 2), scale: 1, yaw: 0 } as Parameters<typeof patrolContactLands>[2];
  const reach = vi.spyOn(reachQueries, 'canReach').mockReturnValue(true);
  expect(patrolContactLands(runner, strike, actor, player, 'actor', null)).toBe(true);
  reach.mockReturnValue(false);
  expect(patrolContactLands(runner, strike, actor, player, 'actor', null)).toBe(false);
  reach.mockReturnValue(true);
  actor.position.x = 100;
  expect(patrolContactLands(runner, strike, actor, player, 'actor', null)).toBe(false);
  expect(patrolContactLands(runner, strike, actor, player, 'player', null)).toBe(true);
});
