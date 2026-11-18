import { expect, test } from 'vitest';
import { SCRIPT_V1_COMMANDS as DO, SCRIPT_V1_EVENTS as ON } from '@wildshard/format/scriptAbiV1';
import { decisionGuest, decisionWorld, runDecisionWorld, HARNESS_IDS } from './fixtures/decisionHarness';

// ONE-FORMAT AC6 (Q-CC48 (b)): a shape-shifter whose skeleton changes despawns and its other form spawns in its place,
// keeping its hp %. `despawn` [own actor, the actor that takes its place or 0]: the leaving body pays no death, credit or
// loot; the arriving one stands where it stood, facing its way, at the same share of its own max hp.
const { a, b } = HARNESS_IDS;
const shifter = `for(let i=0;i<events();i++){const k=i32(ev(i,0));if(k==${ON.start})emit(${DO.despawn},${b},0,0,0);
if(k==${ON.tick}){setState(0,state(0)+1);if(state(0)==2)emit(${DO.despawn},${a},${b},0,0);}}`;

async function run() {
  const guest = await decisionGuest(shifter, { states: 1 });
  const world = decisionWorld(guest, { on: ['start', 'tick'], tick: 10, commands: ['despawn'], state: [{ name: 'calls', type: 'f64', default: 0, scope: 'binding' }] });
  const species = world.source.rows.species[0]; if (species === undefined) throw new Error('Missing boar');
  // the other form: a bigger body with twice the hp
  world.source.rows.species.push({ ...structuredClone(species), id: 'bear', kind: 'bear', label: 'Bear',
    variants: species.variants.map(row => ({ ...structuredClone(row), id: 'bear', hp: 200 })) });
  const second = world.source.creatures.spawns[1]; if (second === undefined) throw new Error('Missing second spawn');
  Object.assign(second, { species: 'bear', variant: 'bear' });
  return runDecisionWorld(world);
}

test('despawn swaps a form for its other, keeping hp %', async () => {
  const live = await run();
  try {
    const host = live.live.host, first = host.entities.get('actor.a'), other = host.entities.get('actor.b');
    if (first === undefined || other === undefined) throw new Error('Missing forms');
    const died: string[] = [];
    host.events.on('actor.died', ({ actor }) => { died.push(actor.id); }, host.scope);
    live.decide();
    // the other form waits out of the world from the start
    expect(other.alive).toBe(false); expect(other.position.y).toBeLessThan(-1000);
    first.hp = 30; first.place(4, 9, 1.25, first.position.y);
    for (let tick = 0; tick < 600 && !other.alive; tick++) live.step();
    expect(other.alive).toBe(true);
    expect(other.hp).toBe(60); expect(other.maxHp).toBe(200);
    expect([other.position.x, other.position.z, other.yaw]).toEqual([4, 9, 1.25]);
    expect(first.alive).toBe(false); expect(first.position.y).toBeLessThan(-1000);
    expect(died).toEqual([]);
    expect(live.decisions.host.metrics()[0]).toMatchObject({ refusals: 0 });
    // the swap is saved: a restore keeps the waiting form out of the world
    const saved = live.decisions.snapshot();
    Object.assign(first, { hidden: false });
    live.decisions.restore(saved);
    expect((first as { hidden?: boolean }).hidden).toBe(true);
  } finally { live.dispose(); }
});
