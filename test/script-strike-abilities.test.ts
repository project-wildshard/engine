import { expect, test } from 'vitest';
import { SCRIPT_V1_COMMANDS as DO, SCRIPT_V1_EVENTS as ON } from '@wildshard/format/scriptAbiV1';
import { decisionGuest, decisionWorld, runDecisionWorld, HARNESS_IDS } from './fixtures/decisionHarness';

// ONE-FORMAT AC6: a script-driven creature (the stranger mech) strikes from its own catalogue; a strike its species also
// lists as an ability keeps that ability's knockback and projectile, as the same strike does under a brain.
const STOMP = { use: 'bump', range: 3, cooldown: 1, weight: 1, effect: 'knockback' as const, strength: 4 };
const ROCKET = { use: 'bump', range: 3, cooldown: 1, weight: 1, projectile: { speed: 12, gravity: 0, radius: 0.3 } };

async function world(ability?: typeof STOMP | typeof ROCKET) {
  const guest = await decisionGuest(`for(let i=0;i<events();i++){if(ev(i,0)==${ON['player.join']})emit(${DO.strike},${HARNESS_IDS.a},1,ev(i,1),0);}`);
  const built = decisionWorld(guest, { on: ['start', 'player.join'], commands: ['strike'] });
  const species = built.source.rows.species[0]; if (species === undefined) throw new Error('Missing boar');
  if (ability !== undefined) Object.assign(species, { abilities: [ability], temperament: { brain: 'none', reaction: 'aggressive', leash: 40, assist: 0, home: { speed: 2, stop: 1 } } });
  return runDecisionWorld(built);
}

test('a scripted strike keeps its species ability knockback', async () => {
  const shoved = async (ability?: typeof STOMP): Promise<number> => {
    const run = await world(ability);
    try {
      const body = run.live.host.entities.get('actor.a'), player = run.live.host.focusedPlayer;
      if (body === undefined) throw new Error('Missing boar');
      player.resetPose({ x: body.position.x, y: body.position.y, z: body.position.z + 2 }, 0);
      const before = Math.hypot(player.position.x - body.position.x, player.position.z - body.position.z);
      run.decide(); run.step(90);
      expect(player.health.attributes.health).toBeLessThan(player.health.attributes.maxHealth);
      return Math.hypot(player.position.x - body.position.x, player.position.z - body.position.z) - before;
    } finally { run.dispose(); }
  };
  expect(await shoved(STOMP)).toBeGreaterThan(2);
  expect(await shoved()).toBeLessThan(1);
});

test('a scripted strike keeps its species ability projectile', async () => {
  const run = await world(ROCKET);
  try {
    const [bump] = run.live.host.strikeSpecifications('actor.a');
    expect(bump?.projectile).toEqual(ROCKET.projectile);
  } finally { run.dispose(); }
  const plain = await world();
  try { expect(plain.live.host.strikeSpecifications('actor.a')[0]?.projectile).toBeUndefined(); } finally { plain.dispose(); }
});
