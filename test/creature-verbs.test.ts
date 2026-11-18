import { expect, test } from 'vitest';
import { SCRIPT_V1_COMMANDS as DO, SCRIPT_V1_EVENTS as ON } from '@wildshard/format/scriptAbiV1';
import { installStatusEffects } from '../src/server/game/shardfile/statusEffects';
import { decisionGuest, decisionWorld, runDecisionWorld, HARNESS_IDS } from './fixtures/decisionHarness';

// ONE-FORMAT CC32: `Do.lockable`, `Do.heal`, pull and root, each a decision command a creature script sends.
const joined = (body: string): string => `for(let i=0;i<events();i++){if(ev(i,0)==${ON['player.join']}){${body}}}`;
const every = { on: ['start', 'tick', 'player.join'] as ('start' | 'tick' | 'player.join')[], tick: 10 as const };

test('Do.lockable takes a creature out of lock and Tab, and back', async () => {
  const guest = await decisionGuest(`emit(${DO.lockable},${HARNESS_IDS.a},state(0)>0?1.0:0.0,0,0);setState(0,state(0)+1);`);
  const run = await runDecisionWorld(decisionWorld(guest, { ...every, commands: ['lockable'] }));
  try {
    const body = run.live.host.entities.get('actor.a');
    expect(body?.lockable).toBe(true);
    run.decide(); expect(body?.lockable).toBe(false);
    expect(run.live.host.entities.get('actor.b')?.lockable).toBe(true);
    // The override is the decision's continuation, not the body's: it survives a save.
    const saved = run.decisions.snapshot(); run.decide(); expect(body?.lockable).toBe(true);
    run.decisions.restore(saved); expect(body?.lockable).toBe(false);
    expect(run.decisions.host.metrics()[0]).toMatchObject({ refusals: 0 });
  } finally { run.dispose(); }
});

test('Do.heal mends its own creature and clamps at max hp', async () => {
  const guest = await decisionGuest(`emit(${DO.heal},${HARNESS_IDS.a},30,0,0);`);
  const run = await runDecisionWorld(decisionWorld(guest, { ...every, commands: ['heal'] }));
  try {
    const body = run.live.host.entities.get('actor.a'); if (body === undefined) throw new Error('Missing boar');
    body.hp = 50;
    run.decide(); expect(body.hp).toBe(80);
    run.decide(); expect(body.hp).toBe(100);
    expect(body.maxHp).toBe(100);
  } finally { run.dispose(); }
});

test('a 6 m pull draws the player 6 m toward the creature', async () => {
  const guest = await decisionGuest(joined(`emit(${DO.pull},ev(i,1),6,${HARNESS_IDS.a},0);`));
  const run = await runDecisionWorld(decisionWorld(guest, { on: ['start', 'player.join'], commands: ['pull'] }));
  try {
    const body = run.live.host.entities.get('actor.a'), player = run.live.host.focusedPlayer;
    if (body === undefined) throw new Error('Missing boar');
    player.resetPose({ x: body.position.x, y: body.position.y, z: body.position.z + 12 }, 0);
    const before = player.position.distanceTo(body.position);
    run.decide(); run.step(60);
    const after = Math.hypot(player.position.x - body.position.x, player.position.z - body.position.z);
    expect(before - after).toBeGreaterThan(5.5); expect(before - after).toBeLessThan(6.5);
  } finally { run.dispose(); }
});

test('root holds the player for its time and shows as a status', async () => {
  const guest = await decisionGuest(joined(`emit(${DO.root},ev(i,1),2,0,0);`));
  const run = await runDecisionWorld(decisionWorld(guest, { on: ['start', 'player.join'], commands: ['root'] }));
  try {
    const player = run.live.host.focusedPlayer;
    run.decide();
    expect(player.moveLocked).toBe(true);
    expect(installStatusEffects(run.live.host).active(player.health).map(effect => [effect.def.id, effect.def.icon])).toContainEqual(['effect.root', 'status-root']);
    run.step(100); expect(player.moveLocked).toBe(true);
    run.step(30); expect(player.moveLocked).toBe(false);
  } finally { run.dispose(); }
});
