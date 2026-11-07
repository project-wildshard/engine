import { expect, test } from 'vitest';
import { TreeGrid } from './placement';

test('trunk queries retain circle edges, bucket order and live row identity', () => {
  const rows = Array.from({ length: 250 }, (_, i) => ({ x: (i * 17 % 83) - 41, z: (i * 31 % 79) - 39, r: (i % 11) / 10 }));
  rows.push({ x: -0, z: 0, r: 0 }, { x: 5, z: 0, r: 0 }, { x: 3, z: 4, r: 0 });
  const grid = new TreeGrid<(typeof rows)[number]>();
  for (const row of rows) grid.add(row);
  const original = (x: number, z: number, radius: number) => {
    const cx = Math.floor(x / 16), cz = Math.floor(z / 16), out = [];
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const row of rows) if (Math.floor(row.x / 16) === cx + i && Math.floor(row.z / 16) === cz + j
        && Math.hypot(row.x - x, row.z - z) < radius + row.r + 3) out.push(row);
    }
    return out;
  };
  for (const radius of [-5, -0, 0, 2, 12, Infinity, Number.NaN]) {
    for (let i = 0; i < 100; i++) {
      const x = (i * 7 % 71) - 35, z = (i * 13 % 73) - 36;
      const actual = grid.nearby(x, z, radius), expected = original(x, z, radius);
      expect(actual).toEqual(expected);
      actual.forEach((row, index) => expect(row).toBe(expected[index]));
    }
    expect(grid.nearby(0, 0, radius)).toEqual(original(0, 0, radius));
  }
  const moved = rows[0];
  if (moved === undefined) throw new Error('Missing tree');
  moved.x += .25; moved.z -= .25; moved.r = 3;
  expect(grid.nearby(moved.x, moved.z, 0)).toContain(moved);
});
