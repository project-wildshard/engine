import { expect, test } from 'vitest';
import * as v from 'valibot';
import { ArenaFightPageSchema } from '../src/shared/game/boss/arenaRoomRows';
import king from './fixtures/nalati-goldenKing-original.json' with { type: 'json' };

test('the arena body adapter admits an unrelated orchard guardian and its own placement and strikes', () => {
  const original = v.parse(ArenaFightPageSchema, king.page);
  const row = v.parse(ArenaFightPageSchema, { ...original, body: 'orchard.guardian', identity: 'declared', damageTag: 'boss.orchard-guardian',
    add: { kind: 'orchard-sentry', variant: 'warden', memory: { floorY: 12, emergeT: 3 } }, maxZ: 24,
    reward: [10,14,18], respawn: [5,12,8], yaw: 1.4, cuts: original.cuts.slice(0,2), hazards: { bloom: original.hazards['sand'] },
  });
  expect(row.body).toBe('orchard.guardian'); expect(row.cuts).toHaveLength(2);
  expect(row.add.memory).toEqual({ floorY: 12, emergeT: 3 }); expect(Object.keys(row.hazards)).toEqual(['bloom']);
  expect(v.safeParse(ArenaFightPageSchema, { ...row, spawn: () => null }).success).toBe(false);
});
