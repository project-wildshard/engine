import { expect, test } from 'vitest';
import { SCRIPT_V1_COMMANDS as DO, SCRIPT_V1_READS as READ } from '@wildshard/format/scriptAbiV1';
import { decisionGuest, decisionWorld, runDecisionWorld, HARNESS_IDS } from './fixtures/decisionHarness';

// Meta MOSSGATE-ZONE MZ20: a decision's strike lands on the player its script reads (OF25a: the one nearest its creature),
// not on whichever player the host had when it installed. Mossgate's Barrow Warden struck at `nearestPlayer`, but with two
// players on the dev server every blow went at the first one, standing off, so the one at its side was never hit.
test('a scripted strike at the nearest player lands on that player, with the first player far off', async () => {
  const a = HARNESS_IDS.a;
  const guest = await decisionGuest(`const p=read(${READ.nearestPlayer},${a},0);if(p!=0&&state(0)==0){emit(${DO.strike},${a},1,p,0);setState(0,1);}`);
  const run = await runDecisionWorld(decisionWorld(guest, { on: ['start', 'tick'], tick: 10, commands: ['strike'], reads: ['nearestPlayer'] }));
  try {
    const { host } = run.live, body = host.entities.get('actor.a');
    if (body === undefined) throw new Error('Missing boar');
    // Ana, the host's first player, 12 m off; Bo 1.5 m from actor.a, inside its 3 m bump
    const ana = host.focusedPlayer, bo = host.addPlayer('bo', { x: body.position.x, y: body.position.y, z: body.position.z + 1.5 });
    ana.resetPose({ x: body.position.x, y: body.position.y, z: body.position.z - 12 }, 0);
    run.decide(); run.step(60);
    expect(bo.health.attributes.health).toBeLessThan(bo.health.attributes.maxHealth);
    expect(ana.health.attributes.health).toBe(ana.health.attributes.maxHealth);
    expect(run.decisions.host.metrics()[0]).toMatchObject({ refusals: 0, disabled: false });
  } finally { run.dispose(); }
});
