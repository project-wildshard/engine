import { expect, it } from 'vitest';
import { StrikeRunner, type StrikeActor, type StrikeSpec } from './strikes';

it('lets owners query overlap without cover, damage or continuation effects', () => {
  const runner = new StrikeRunner();
  const actor: StrikeActor = { position: { x: 0, y: 0, z: 0 }, alive: true, scale: 1, yaw: 0,
    startAttack: () => undefined, cancelAttack: () => undefined, setMotion: () => undefined };
  const spec: StrikeSpec = { id: 'melee', shape: { kind: 'arc', radius: 4, halfAngle: 0.5 }, units: 'world',
    windup: 0, active: 0, recover: 0, cooldown: 0, range: Infinity, damage: 12, tags: ['cover.checked'], weight: () => 1 };
  const before = runner.snapshot();
  let reach = 0, damage = 0;
  for (const target of [{ x: 0, y: 0, z: 2 }, { x: 0, y: 0, z: -2 }, { x: 0, y: 0, z: 5 }]) {
    const overlaps = runner.contains(spec, { actor, target });
    expect(runner.snapshot()).toEqual(before);
    expect(runner.contact(spec, { actor, target, canReach: () => { reach++; return false; }, hit: row => { damage += row.damage; } })).toBe(false);
    expect(reach).toBe(overlaps ? 1 : 0);
    reach = 0;
    expect(runner.contact({ ...spec, tags: ['cover.exempt'] }, { actor, target, canReach: () => { reach++; return false; }, hit: row => { damage += row.damage; } })).toBe(overlaps);
    expect(reach).toBe(0);
    expect(damage).toBe(overlaps ? spec.damage : 0);
    damage = 0;
  }
  expect(runner.snapshot()).toEqual(before);
});

it('a lane with no speed is a stationary beam: it ends at its active window, not a charge timeout', () => {
  // ONE-FORMAT AC6: the stranger mech's laser is a 14 m lane fired from where it stands
  const runner = new StrikeRunner();
  const actor: StrikeActor = { position: { x: 0, y: 0, z: 0 }, alive: true, scale: 1, yaw: 0,
    startAttack: () => undefined, cancelAttack: () => undefined, setMotion: () => undefined };
  const spec: StrikeSpec = { id: 'laser', shape: { kind: 'lane', length: 14, width: 1.2 }, units: 'world', motion: { speed: 0 },
    windup: 0.2, active: 0.12, recover: 0.4, cooldown: 0, range: 14, damage: 1, tags: [], weight: () => 1 };
  let hits = 0;
  const ctx = { actor, target: { x: 0, y: 0, z: 6 }, canReach: () => true, hit: () => { hits++; } };
  runner.start(spec, actor, ctx.target);
  for (let tick = 0; tick < 60 && runner.state !== 'idle'; tick++) runner.update(1 / 60, ctx);
  expect([runner.state, hits]).toEqual(['idle', 1]);
});
