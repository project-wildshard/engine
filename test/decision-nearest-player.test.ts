import { expect, test } from 'vitest';
import { SCRIPT_V1_COMMANDS as DO, SCRIPT_V1_READS as READ } from '@wildshard/format/scriptAbiV1';
import { decisionGuest, decisionWorld, runDecisionWorld, HARNESS_IDS } from './fixtures/decisionHarness';

// ONE-FORMAT OF25a: a decision script deals with the player nearest its own creature, not whichever player the host last
// turned to. The stranger's chameleon (hidden until a player is inside 4 m, then a 6 m tongue pull) never revealed on
// staging while a second player stood across the map: its script read that one.
test('a creature script reads and pulls the player nearest its creature, with a second player far off', async () => {
  const a = HARNESS_IDS.a;
  const guest = await decisionGuest(`const p=read(${READ.nearestPlayer},${a},0);const d=p==0?1e9:read(${READ.distance},${a},p);
if(d<=4){emit(${DO.lockable},${a},1,0,0);if(state(0)==0){emit(${DO.pull},p,6,${a},0);setState(0,1);}}else{emit(${DO.lockable},${a},0,0,0);}`);
  const run = await runDecisionWorld(decisionWorld(guest, { on: ['start', 'tick'], tick: 10, commands: ['lockable', 'pull'], reads: ['nearestPlayer', 'distance'] }));
  try {
    const { host } = run.live, body = host.entities.get('actor.a'), other = host.entities.get('actor.b');
    if (body === undefined || other === undefined) throw new Error('Missing boars');
    // Ana 3.5 m from actor.a; Bo by actor.b, 4.5 m from actor.a: the last body the host visits turns to Bo.
    const ana = host.focusedPlayer, bo = host.addPlayer('bo', { x: other.position.x, y: other.position.y, z: other.position.z + 2.5 });
    ana.resetPose({ x: body.position.x, y: body.position.y, z: body.position.z - 3.5 }, 0);
    const anaFrom = ana.position.clone(), boFrom = bo.position.clone();
    run.decide(); run.step(30);
    expect(body.lockable).toBe(true);
    expect(anaFrom.distanceTo(ana.position)).toBeGreaterThan(2);
    expect(boFrom.distanceTo(bo.position)).toBeLessThan(0.5);
    expect(run.decisions.host.metrics()[0]).toMatchObject({ refusals: 0, disabled: false });
  } finally { run.dispose(); }
});
