import { expect, test } from 'vitest';
import { HOLD_MS } from '../src/server/host/dedicated/cellProtocol';
import { HOLD_DEVICE, OTHER_DEVICE, HOLD_HIT, heldBody, holdUntil, openHoldBench } from './fixtures/dedicated/holdBench';

// Retained E7.3b/J114 40 s outage. The real socket, proxy, silence detection and ticks run on real time; the
// room's hold clock skips the idle seconds (VITEST-BENCH VB5), so the 30 s hold is the product's own HOLD_MS.
test('40 s under: back where it stood with its saved hurt body and pack', { timeout: 60_000 }, async () => {
  const state = await openHoldBench(), { puller, through, a, room, body, full, roomNow, roomAt, roomChecked } = state;
  try {
    expect(HOLD_MS, 'J114: the hold is 30 s').toBe(30_000);
    const then = body.position.clone(), gone = roomNow();
    puller.pull();
    await holdUntil(() => room.holding === 1);
    roomAt(gone, 28_000);
    await roomChecked();
    expect(room.holds(HOLD_DEVICE), 'still held at 28 s and two checks on').toBe(true);
    body.health.attributes.health = full - HOLD_HIT;
    await holdUntil(() => !room.holds(HOLD_DEVICE));
    const heldFor = (roomNow() - gone) / 1000;
    expect(heldFor, 'room time, not 33 s').toBeGreaterThan(29);
    expect(heldFor).toBeLessThan(31.5);
    expect(room.holds(OTHER_DEVICE), 'the other phone stays').toBe(true);
    roomAt(gone, 40_000);
    puller.restore();
    const returned = await state.join(through, HOLD_DEVICE, a.client.ledgerSerial);
    expect(JSON.parse(returned.resume ?? '{}').at.x).toBeCloseTo(then.x, 0);
    const again = heldBody(room);
    expect(again.position.distanceTo(then)).toBeLessThan(0.5);
    expect(again.health.attributes.health, 'the save has the hurt body').toBeLessThan(full);
    expect(room.cell.owned.of(again.id).purse.coins).toBe(9);
    expect(room.cell.owned.of(again.id).owned.has('cape')).toBe(true);
    console.info(`hold: socket closed under 4.5 s, seat freed after ${heldFor.toFixed(1)} s`);
  } finally { await state.close(); }
});
