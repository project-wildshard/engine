import { expect, test } from 'vitest';
import { HOLD_DEVICE, OTHER_DEVICE, HOLD_HIT, heldBody, holdSleep, holdUntil, openHoldBench } from './fixtures/dedicated/holdBench';

// Retained E7.3b/J114 real 40 s outage. A separate fresh session keeps the
// original 30 s hold/expiry/return assertions below the existing 60 s file cap.
test('40 s under: back where it stood with its saved hurt body and pack', { timeout: 150_000 }, async () => {
  const state = await openHoldBench(), { puller, through, a, room, body, full } = state;
  try {
    const then = body.position.clone(), gone = performance.now();
    puller.pull();
    await holdSleep(29_000);
    body.health.attributes.health = full - HOLD_HIT;
    await holdUntil(() => !room.holds(HOLD_DEVICE));
    const heldFor = (performance.now() - gone) / 1000;
    expect(heldFor, 'real time, not 33 s').toBeGreaterThan(29);
    expect(heldFor).toBeLessThan(31.5);
    expect(room.holds(OTHER_DEVICE), 'the other phone stays').toBe(true);
    await holdSleep(40_000 - (performance.now() - gone));
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
