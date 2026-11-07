import { expect, test, vi } from 'vitest';
import type { GrappleRows } from '@wildshard/format/grapple';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { prepareGrappleFonts } from '../src/client/game/grapple/fontPreparation';

const row = {
  mark: { style: { font: '700 15px monospace', lineHeight: '1' }, className: 'marker', glyph: '◇', color: '#abc' },
  chip: { style: { font: '700 10px monospace', letterSpacing: '1.5px' }, className: 'chip',
    candidate: '◇ CANDIDATE', lockedTouch: '◆ TOUCH', lockedDesk: '◆ KEYS', color: '#abc', lockedColor: '#def' },
} satisfies Pick<GrappleRows['aim'], 'mark' | 'chip'>;

test('prepare every visible label variant without reading metrics or changing rows', () => {
  const calls: { font: string; letterSpacing: string; text: string }[] = [], original = structuredClone(row);
  const context: Pick<CanvasRenderingContext2D, 'font' | 'letterSpacing' | 'measureText'> = {
    font: '', letterSpacing: '', measureText: text => {
      calls.push({ font: context.font, letterSpacing: context.letterSpacing, text });
      return legacyDouble<TextMetrics>({}); // Any attempt to use metrics to alter layout refuses.
    },
  };
  const create = vi.fn(() => context);
  prepareGrappleFonts(row, create);
  expect(create).toHaveBeenCalledOnce();
  expect(calls).toEqual([
    { font: row.mark.style.font, letterSpacing: '0px', text: row.mark.glyph },
    ...[row.chip.candidate, row.chip.lockedTouch, row.chip.lockedDesk].map(text => ({ font: row.chip.style.font, letterSpacing: row.chip.style.letterSpacing, text })),
  ]);
  expect(row).toEqual(original);
});

test('an inherited font adds no canvas requirement to the original label contract', () => {
  const create = vi.fn(() => { throw new Error('Unexpected native context'); });
  prepareGrappleFonts({ mark: { ...row.mark, style: {} }, chip: { ...row.chip, style: {} } }, create);
  expect(create).not.toHaveBeenCalled();
});

test('native preparation failures propagate', () => {
  expect(() => prepareGrappleFonts(row, () => { throw new Error('Native text context failed'); })).toThrow('Native text context failed');
});
