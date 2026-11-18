import { expect, test } from 'vitest';
import { SCRIPT_V1_COMMANDS as DO, SCRIPT_V1_EVENTS as ON } from '@wildshard/format/scriptAbiV1';
import { spawnAbsent } from '../src/server/game/shardfile/declaredSpawnWhen';
import { decisionGuest, decisionWorld, runDecisionWorld, type DecisionWorld } from './fixtures/decisionHarness';

// ONE-FORMAT CC59c: an encounter phase's adds wait out of the world until the fight reaches that phase, or a decision's
// `spawn` calls them; a reset fight sends them away again.
const IMPS = ['imp.1', 'imp.2', 'imp.3'], IMP_ONE = 3;

function withAdds(world: DecisionWorld): DecisionWorld {
  const boar = world.source.creatures.spawns[0]; if (boar === undefined) throw new Error('Missing boar');
  world.source.creatures.spawns.push(...IMPS.map((id, index) => ({ ...boar, id, seed: 10 + index, at: [12 + index * 2, 0, 20] as [number, number, number] })));
  const fight = world.source.encounters[0], first = fight?.phases[0]; if (fight === undefined || first === undefined) throw new Error('Missing encounter');
  fight.phases = [first, { ...first, at: 0.5, name: 'Adds', caption: 'Adds', adds: IMPS }];
  return world;
}
async function fighting(body: string, script: Parameters<typeof decisionWorld>[1] = {}) {
  const run = await runDecisionWorld(withAdds(decisionWorld(await decisionGuest(body), script)));
  const fight = run.live.encounters.get('encounter.0'), boss = run.live.host.entities.get('actor.a');
  if (fight === undefined || boss === undefined) throw new Error('Missing fight');
  const imps = (): boolean[] => IMPS.map(id => run.live.host.entities.get(id)?.alive === true);
  return { run, fight, boss, imps, untilFight: (): void => { for (let i = 0; i < 120 && fight.boss.state !== 'fight'; i++) run.step(); } };
}

test('a phase row brings out its three adds', async () => {
  const at = await fighting('');
  try {
    expect(at.imps()).toEqual([false, false, false]);
    at.untilFight(); expect(at.fight.boss.state).toBe('fight');
    at.run.step(10); expect(at.imps()).toEqual([false, false, false]);
    at.boss.hp = at.boss.maxHp * 0.4; at.run.step(10);
    expect(at.fight.boss.phase).toBe(1);
    expect(at.imps()).toEqual([true, true, true]);
    expect(at.run.live.host.entities.get('imp.2')?.position.x).toBeCloseTo(14);
  } finally { at.run.dispose(); }
});

test('a decision spawn calls one add out before its phase', async () => {
  const at = await fighting(`for(let i=0;i<events();i++){if(ev(i,0)==${ON.start})emit(${DO.spawn},0,${IMP_ONE},0,0);}`,
    { on: ['start'], commands: ['spawn'], spawns: { imp: 'imp.1' } });
  try {
    at.run.decide();
    expect(at.imps()).toEqual([true, false, false]);
  } finally { at.run.dispose(); }
});

test('a reset fight sends its adds away until the phase comes again', async () => {
  const at = await fighting('');
  try {
    at.untilFight(); at.boss.hp = at.boss.maxHp * 0.4; at.run.step(10);
    expect(at.imps()).toEqual([true, true, true]);
    // everyone leaves the arena: the fight resets (BossContenders' disarm and re-arm)
    at.run.live.host.focusedPlayer.resetPose({ x: 120, y: 0, z: 120 }, 0);
    at.fight.boss.disarm(); at.fight.boss.arm(); at.run.step(2);
    expect(at.fight.boss.state).toBe('armed');
    expect(at.imps()).toEqual([false, false, false]);
    expect(IMPS.every(id => { const b = at.run.live.host.entities.get(id); return b !== undefined && spawnAbsent(b); })).toBe(true);
    // and the next time the fight reaches the phase they come back
    at.run.live.host.focusedPlayer.resetPose({ x: 0, y: 0, z: 0 }, 0);
    at.boss.hp = at.boss.maxHp; at.untilFight(); at.boss.hp = at.boss.maxHp * 0.4; at.run.step(10);
    expect(at.imps()).toEqual([true, true, true]);
  } finally { at.run.dispose(); }
});
