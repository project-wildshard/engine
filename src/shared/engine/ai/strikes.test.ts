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
