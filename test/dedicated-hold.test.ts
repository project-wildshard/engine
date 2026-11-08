import { expect, test } from 'vitest';
import { HOLD_DEVICE, HOLD_HIT, heldBody, holdSleep, holdUntil, openHoldBench } from './fixtures/dedicated/holdBench';

// Retained E7.3b/J114 real-clock coverage, split at independent outage branches.
// This is the original 20 s branch, not a new slow test or a shortened hold.
test('20 s under: the same body, its health less the hit, its pack', { timeout: 150_000 }, async () => {
  const state = await openHoldBench(), { puller, through, a, b, room, body, full, stood } = state;
  try {
    const under = performance.now(), heard = b.client.entities.size;
    puller.pull();
    await holdUntil(() => room.holding === 1);
    expect((performance.now() - under) / 1000, 'J114: 3 s of silence ends the socket').toBeLessThan(4.5);
    expect(room.taken).toBe(2);
    expect(room.host.players.get(body.id), 'the body stays').toBe(body);
    expect(b.client.entities.size, 'and the other phone still sees it').toBe(heard);
    await holdSleep(20_000 - (performance.now() - under));
    body.health.attributes.health = full - HOLD_HIT;
    puller.restore();
    await state.join(through, HOLD_DEVICE, a.client.ledgerSerial);
    expect(a.closed === null || a.closed === 'lost' || a.closed === 'stalled').toBe(true);
    expect(room.holding).toBe(0);
    expect(heldBody(room), 'the same body').toBe(body);
    expect(body.position.distanceTo(stood)).toBeLessThan(0.5);
    expect(body.health.attributes.health).toBeGreaterThanOrEqual(full - HOLD_HIT);
    expect(body.health.attributes.health).toBeLessThan(full);
    expect(room.cell.owned.of(body.id).owned.has('cape')).toBe(true);
    expect(room.cell.owned.of(body.id).purse.coins).toBe(9);
  } finally { await state.close(); }
});
