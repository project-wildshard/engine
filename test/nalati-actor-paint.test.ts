import { expect, it } from 'vitest';
import { SHAPES } from './fixtures/nalatiShapes';
import { installWorldFixture } from './fixtures/worldSetup';

await installWorldFixture();

it('returns independent geometry for dungeon transforms and refuses missing shapes', () => {
  const a = SHAPES.handle('balbal:0:2977').copy(), b = SHAPES.handle('balbal:0:2977').copy();
  const x = b.getAttribute('position').getX(0);
  a.translate(12, 3, -4);
  expect(b.getAttribute('position').getX(0)).toBe(x);
  expect(() => SHAPES.handle('absent')).toThrow('Undeclared fixed draw');
  a.dispose(); b.dispose();
});
