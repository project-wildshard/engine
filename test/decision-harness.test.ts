import { expect, test } from 'vitest';
import { SCRIPT_V1_COMMANDS, SCRIPT_V1_EVENTS } from '@wildshard/format/scriptAbiV1';
import { decisionGuest, decisionWorld, runDecisionWorld, HARNESS_IDS } from './fixtures/decisionHarness';

// CC59h: a few lines of guest source run one decision tick through the real host.
test('a harness guest writes a field on start and the host publishes it after one decision tick', async () => {
  const guest = await decisionGuest(`for(let i=0;i<events();i++){if(ev(i,0)==${SCRIPT_V1_EVENTS.start})emit(${SCRIPT_V1_COMMANDS.field},${HARNESS_IDS.a},${HARNESS_IDS.phase},2,0);}`);
  const run = await runDecisionWorld(decisionWorld(guest));
  try {
    run.decide();
    expect(run.decisions.publication().fields).toContainEqual({ actor: HARNESS_IDS.a, field: HARNESS_IDS.phase, value: 2 });
    expect(run.decisions.host.metrics()[0]).toMatchObject({ calls: 1, commands: 1, refusals: 0, disabled: false });
  } finally { run.dispose(); }
});

test('a harness guest command outside the row capability is refused, not applied', async () => {
  const guest = await decisionGuest(`emit(${SCRIPT_V1_COMMANDS.field},${HARNESS_IDS.a},${HARNESS_IDS.phase},3,0);`);
  const world = decisionWorld(guest, { commands: ['move'] });
  const run = await runDecisionWorld(world);
  try {
    run.decide();
    expect(run.decisions.publication().fields).toContainEqual({ actor: HARNESS_IDS.a, field: HARNESS_IDS.phase, value: 0 });
    expect(run.decisions.host.metrics()[0]).toMatchObject({ calls: 1, refusals: 1 });
  } finally { run.dispose(); }
});
