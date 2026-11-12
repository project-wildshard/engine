// GC2 (GRID-CROSSING): the online grid's border. The server still walls each cell (C5), so a page whose prediction runs ahead
// onto the rim at boost has not left; and a page whose feet come back into a cell it left must enter it again even while the
// frame gate is shut, or no frame ever runs again (the first repro's turn back: 120 s, "on the road", the view frozen).
import { describe, expect, it } from 'vitest';
import { cellPresence, gateEnters, HELD_RIM } from './cellPresence';

const driftwood = { instance: 'driftwood-isle', slug: 'driftwood-isle' };
const farReach = { instance: 'far-reach', slug: 'far-reach' };

describe('cellPresence', () => {
  it('enters the cell under the feet when it is the crossing\'s current cell', () => {
    expect(cellPresence(driftwood, 'driftwood-isle', false, 0)).toEqual({ kind: 'enter', ...driftwood });
    expect(cellPresence(driftwood, 'driftwood-isle', true, 0)).toEqual({ kind: 'enter', ...driftwood });
  });
  it('keeps the cell while the server still holds the body in it and the feet are on its rim (C5 wall, prediction ahead)', () => {
    expect(cellPresence(undefined, 'driftwood-isle', true, 6)).toEqual({ kind: 'keep' });
    expect(cellPresence(undefined, 'driftwood-isle', true, HELD_RIM)).toEqual({ kind: 'keep' });
  });
  it('leaves on the road when no server holds the body there (solo grid, or the server moved it)', () => {
    expect(cellPresence(undefined, 'driftwood-isle', false, 6)).toEqual({ kind: 'leave' });
    expect(cellPresence(undefined, null, false, Infinity)).toEqual({ kind: 'leave' });
  });
  it('leaves once the feet are past the held rim: the page is no longer where the server has it (a stalled link)', () => {
    expect(cellPresence(undefined, 'driftwood-isle', true, HELD_RIM + 0.1)).toEqual({ kind: 'leave' });
  });
  it('leaves when the feet stand in another cell than the current one, held or not', () => {
    expect(cellPresence(farReach, 'driftwood-isle', true, 62.5)).toEqual({ kind: 'leave' });
    expect(cellPresence(farReach, 'driftwood-isle', false, 62.5)).toEqual({ kind: 'leave' });
  });
});

describe('gateEnters', () => {
  it('enters from the gate when the feet are back in the current cell with its runtime not entered', () => {
    expect(gateEnters('driftwood-isle', 'driftwood-isle', null, true)).toBe(true);
  });
  it('does nothing once entered, on the road, in another cell, or for a cell with no runtime hooks', () => {
    expect(gateEnters('driftwood-isle', 'driftwood-isle', 'driftwood-isle', true)).toBe(false);
    expect(gateEnters('driftwood-isle', undefined, null, true)).toBe(false);
    expect(gateEnters('driftwood-isle', 'far-reach', null, true)).toBe(false);
    expect(gateEnters('driftwood-isle', 'driftwood-isle', null, false)).toBe(false);
    expect(gateEnters(null, 'driftwood-isle', null, true)).toBe(false);
  });
});
