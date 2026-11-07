// oxlint-disable-next-line import/no-nodejs-modules -- Real Rapier bytes.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { tagCollider } from '../src/shared/engine/physics/surface';
import { createSimHost } from '../src/server/engine/sim';
import { leadPlayer } from '../src/shared/engine/sim/leadPlayer';
import { captureLiftRider, captureLiftRiders, firstLiftRider, parseLiftRiders, restoreLiftRider } from '../src/shared/game/shardfile/liftRider';
import { SIM_LEVEL } from './fixtures/sim-level/level';

// P1-E3: a lift carries whoever stands on it, so a save names every rider. Alone, the wire stays the bare edge.
const source = { entryways: [{ edge: 'north', kind: 'socketLift', lift: { mover: 'lift.deck', roadStop: [3, 6, 3] } }], spawn: { x: 0, y: 0, z: 0 } } as never;
const movers = { pose: () => ({ position: { x: 3, y: 2, z: 3 } }) } as never, water = { restAt: () => null } as never;

async function room() {
  const rapier = await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm')));
  const host = createSimHost({ ...SIM_LEVEL, entities: [] }, { rapier }), lead = leadPlayer(host), deck = { heightfieldNRows: () => 0 } as never;
  tagCollider(deck, 'wood', 'lift.deck');
  const aboard = (player: typeof lead): void => { Object.assign(player.motor.result, { grounded: true, groundCollider: deck }); };
  return { host, lead, aboard };
}

test('a bot aboard a moving lift saves and lands, and the lead aboard alone keeps the bare edge', async () => {
  const { host, lead, aboard } = await room();
  try {
    const bot = host.addPlayer('bot:1', { x: 9, y: 2, z: 9 });
    aboard(bot);
    const saved = captureLiftRiders(source, { host, movers });
    expect(saved).toEqual({ lead: null, others: { 'bot:1': 'north' } });
    expect(firstLiftRider(saved)).toBeNull();
    expect(parseLiftRiders(structuredClone(saved))).toEqual(saved);
    restoreLiftRider(source, { host, movers, water }, saved);
    expect(bot.position.toArray()).toEqual([0, 0, 0]); // no deck at this stop: the safe spawn, as for the lead
    host.removePlayer('bot:1'); aboard(lead);
    expect(captureLiftRiders(source, { host, movers })).toBe('north');
    expect(captureLiftRider(source, { host, movers })).toBe('north');
    lead.position.set(9, 2, 9); restoreLiftRider(source, { host, movers, water }, 'north');
    expect(lead.position.toArray()).toEqual([0, 0, 0]);
  } finally { host.dispose(); }
});

test('a lift at the road stop has no rider to save', async () => {
  const { host, lead, aboard } = await room();
  try {
    aboard(lead);
    expect(captureLiftRiders(source, { host, movers: { pose: () => ({ position: { x: 3, y: 6, z: 3 } }) } as never })).toBeNull();
  } finally { host.dispose(); }
});
