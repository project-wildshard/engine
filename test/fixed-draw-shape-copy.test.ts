import { expect, it } from 'vitest';
import { SHAPES } from './fixtures/liveRenderRows';


it('returns independent geometry for dungeon transforms and refuses missing shapes', () => {
  const a = SHAPES.handle('fixture.shape').copy(), b = SHAPES.handle('fixture.shape').copy();
  const x = b.getAttribute('position').getX(0);
  a.translate(12, 3, -4);
  expect(b.getAttribute('position').getX(0)).toBe(x);
  expect(() => SHAPES.handle('absent')).toThrow('Undeclared fixed draw');
  a.dispose(); b.dispose();
});
