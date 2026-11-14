import { Vector3 } from 'three';
import { expect, test } from 'vitest';
import { BOSS_RETURN_S, BossContenders } from '../src/server/engine/ai/bossContenders';
import type { PlayerSim } from '../src/server/engine/sim/playerSim';

// SERVER-CELLS SC5 (J328): a grid cell's world is never rebuilt, so a served world's beaten boss comes back on its own, once nobody
// has stood in its arena for J107's five minutes. A page's world (not served) keeps its boss beaten, as it always did.
const player = (x: number): PlayerSim => ({ position: new Vector3(x, 0, 0) }) as unknown as PlayerSim;
const arena = (point: Vector3): boolean => point.x < 10;
function boss(): { state: string; calls: string[]; engaged: boolean; script: { respawnPoint: () => { pos: Vector3; yaw: number } }; disarm: () => void; arm: () => void; onPlayerDeath: () => boolean; returnBeaten: () => void } {
  const row = { state: 'victory', calls: [] as string[], engaged: false, script: { respawnPoint: () => ({ pos: new Vector3(), yaw: 0 }) },
    disarm: () => { row.calls.push('disarm'); row.state = 'dormant'; }, arm: () => { row.calls.push('arm'); row.state = 'armed'; },
    onPlayerDeath: () => false, returnBeaten: () => { row.calls.push('returnBeaten'); row.state = 'dormant'; } };
  return row;
}
const run = (party: BossContenders, fight: ReturnType<typeof boss>, seconds: number): void => { for (let t = 0; t < seconds * 60; t++) party.observe(fight, 1 / 60); };

test('a served world: the beaten boss stands again once its arena has stood empty five minutes', () => {
  const players = new Map([['a', player(50)]]), fight = boss(), party = new BossContenders(players, arena, () => undefined, { served: () => true, rearm: true });
  run(party, fight, BOSS_RETURN_S - 1);
  expect(fight.calls).toEqual([]);
  run(party, fight, 2);
  expect(fight.calls).toEqual(['returnBeaten', 'arm']);
  expect(fight.state).toBe('armed');
});

test('anyone in the arena starts the wait over; a summoned boss goes back to waiting for its summons', () => {
  const near = player(5), players = new Map([['a', near]]), fight = boss(), party = new BossContenders(players, arena, () => undefined, { served: () => true, rearm: false });
  run(party, fight, BOSS_RETURN_S - 10);
  near.position.x = 50;
  run(party, fight, BOSS_RETURN_S - 10);
  expect(fight.calls, 'the wait began when they left').toEqual([]);
  run(party, fight, 20);
  expect(fight.calls).toEqual(['returnBeaten']);
  expect(fight.state).toBe('dormant');
});

test('a page (not served) keeps its boss beaten', () => {
  const fight = boss(), party = new BossContenders(new Map([['a', player(50)]]), arena, () => undefined, { served: () => false, rearm: true });
  run(party, fight, BOSS_RETURN_S + 5);
  expect(fight.calls).toEqual([]);
  expect(fight.state).toBe('victory');
});

test('SC10: a roaming boss put away after its win (dormant, still beaten) comes back too', () => {
  const fight = { ...boss(), state: 'dormant', defeated: true }, party = new BossContenders(new Map([['a', player(50)]]), arena, () => undefined, { served: () => true, rearm: false });
  run(party, fight, BOSS_RETURN_S + 1);
  expect(fight.calls).toEqual(['returnBeaten']);
});

test('SC10: the time a cell slept with nobody in it counts toward the wait', () => {
  const fight = boss(), party = new BossContenders(new Map([['a', player(50)]]), arena, () => undefined, { served: () => true, rearm: true });
  party.slept(BOSS_RETURN_S + 60);
  run(party, fight, 1 / 60);
  expect(fight.calls).toEqual(['returnBeaten', 'arm']);
});
