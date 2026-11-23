import { expect, test } from 'vitest';
import { fitMapLabel, placeInside } from './mapLabel';

const measure = (text: string, font: number): number => text.length * font * 0.55;
test('long cell names wrap inside the same box at phone overview, two and four times zoom', () => {
  for (const zoom of [1, 2, 4]) {
    const text = zoom === 1 ? 'STARFALL OBSERVATORY' : 'OPEN PLOT · STARFALL OBSERVATORY';
    const width = 55 * zoom, height = 23 * zoom;
    const label = fitMapLabel(text, width, height, 11, 8, measure);
    expect(label.lines.length).toBeGreaterThan(0);
    expect(label.lines.join(' ')).toBe(text);
    for (const line of label.lines) expect(measure(line, label.font)).toBeLessThanOrEqual(width);
    expect(label.lines.length * label.font * 1.15).toBeLessThanOrEqual(height);
  }
});
test('a label that cannot fit is hidden instead of escaping its cell', () => {
  expect(fitMapLabel('OBSERVATORY', 10, 10, 11, 8, measure).lines).toEqual([]);
  expect(fitMapLabel('A', Number.NaN, 10, 11, 8, measure).lines).toEqual([]);
});

// QA 11-23-b row 16 (polish board, Names A and Rims A): a neighbour's name is never cut by the frame
test('row 16: a name keeps its spot when it fits, slides inside the frame when its cell is cut, turns along a thin rim', () => {
  const view = { x0: 0, y0: 0, x1: 388, y1: 504 };
  expect(placeInside({ x: 194, y: 100 }, { x0: 40, y0: 40, x1: 348, y1: 348 }, view, 100, 16, 4)).toEqual({ x: 194, y: 100, vertical: false });
  // BRASSCAP MESA: its cell starts 30 px above the frame's bottom, its name, drawn 90 m into the cell, is past the frame; it slides up inside
  const below = placeInside({ x: 194, y: 520 }, { x0: 40, y0: 474, x1: 348, y1: 782 }, view, 110, 16, 4);
  expect(below).toEqual({ x: 194, y: 504 - 4 - 8, vertical: false });
  // a 13 px rim at the left side: turned along it
  const rim = placeInside({ x: -140, y: 260 }, { x0: -295, y0: 140, x1: 13, y1: 448 }, view, 120, 11, 1);
  expect(rim?.vertical).toBe(true); expect(rim?.x).toBeCloseTo(6.5);
  // a corner sliver that holds no whole name: none
  expect(placeInside({ x: 0, y: 0 }, { x0: -300, y0: -300, x1: 8, y1: 8 }, view, 120, 11, 1)).toBeNull();
});
