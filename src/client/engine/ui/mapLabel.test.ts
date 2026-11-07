import { expect, test } from 'vitest';
import { fitMapLabel } from './mapLabel';

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
