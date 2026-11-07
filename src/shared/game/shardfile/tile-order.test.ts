import { describe, expect, it } from 'vitest';
import { tileOf, tileOrder, TILES_PER_SIDE } from './tileOrder';

const ENTRIES = [{ at: [0, 0, 250], width: 8 }, { at: [250, 0, 0], width: 8 }, { at: [0, 0, -250], width: 8 }, { at: [-250, 0, 0], width: 8 }] as const;

describe('tileOrder (G626 home streaming)', () => {
  it('maps cell-local points to 62.5 m tiles, clamping at the edges', () => {
    expect(tileOf(-250, -250)).toEqual({ i: 0, j: 0 });
    expect(tileOf(0, -194)).toEqual({ i: 4, j: 0 });
    expect(tileOf(-0.1, 0)).toEqual({ i: 3, j: 4 });
    expect(tileOf(250, 250)).toEqual({ i: 7, j: 7 });
    expect(tileOf(400, -400)).toEqual({ i: 7, j: 0 });
    expect(() => tileOf(Number.NaN, 0)).toThrow(RangeError);
  });

  it('ranks the spawn ring and every entry tile first, then the rest nearest-first', () => {
    const order = tileOrder({ x: 0, z: -194 }, ENTRIES);
    const first = order.tiles.filter(tile => order.rank(tile) === 0).map(t => `${t.i},${t.j}`).sort();
    // the spawn (4,0) and its ring clipped to the cell, and each 8 m entry's two tiles (it straddles x = 0 or z = 0)
    expect(first).toEqual(['0,3', '0,4', '3,0', '3,1', '3,7', '4,0', '4,1', '4,7', '5,0', '5,1', '7,3', '7,4'].sort());
    expect(order.tiles).toHaveLength(TILES_PER_SIDE ** 2);
    expect(order.rank({ i: 4, j: 2 })).toBe(2);
    expect(order.rankAt(0, 240)).toBe(0);
    expect(order.last).toBe(7);
    const ranks = order.tiles.map(order.rank);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
    expect(() => order.rank({ i: 8, j: 0 })).toThrow(RangeError);
  });

  it('a centred spawn with no entries ranks by ring distance', () => {
    const order = tileOrder({ x: 1, z: 1 });
    expect(order.rank({ i: 4, j: 4 })).toBe(0);
    expect(order.rank({ i: 3, j: 3 })).toBe(0);
    expect(order.rank({ i: 6, j: 4 })).toBe(2);
    expect(order.rank({ i: 0, j: 0 })).toBe(4);
    expect(order.last).toBe(4);
  });
});
