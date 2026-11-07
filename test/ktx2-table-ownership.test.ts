import { expect, test } from 'vitest';
import { splitKtx2 } from '../scripts/ktx2-tables.mjs';

test('KTX2 ownership keeps default asset roots, custom globs and the engine remainder', () => {
  const map = { phone: {
    '/assets/fixture/a.png': 'a.ktx2', '/assets/horizon/fixture-day.webp': 'sky.ktx2',
    '/assets/lut/fixture.bin': 'lut.ktx2', '/custom/b.png': 'b.ktx2', '/shared.png': 'engine.ktx2',
  }, desktop: { '/assets/gpu/other/a.png': 'other.ktx2' } };
  const tables = splitKtx2(map, [{ slug: 'fixture', assetGlobs: ['public/custom/*.{png,jpg}'] }, { slug: 'other' }]);
  expect(tables.get('fixture')?.phone).toEqual({ '/assets/fixture/a.png': 'a.ktx2',
    '/assets/horizon/fixture-day.webp': 'sky.ktx2', '/assets/lut/fixture.bin': 'lut.ktx2', '/custom/b.png': 'b.ktx2' });
  expect(tables.get('other')?.desktop).toEqual({ '/assets/gpu/other/a.png': 'other.ktx2' });
  expect(tables.get('engine')?.phone).toEqual({ '/shared.png': 'engine.ktx2' });
});

test('ambiguous KTX2 ownership still refuses before publishing a table', () => {
  expect(() => splitKtx2({ phone: { '/assets/fixture/a.png': 'a.ktx2' }, desktop: {} },
    [{ slug: 'fixture' }, { slug: 'other', assetGlobs: ['public/assets/fixture/**'] }])).toThrow('ambiguous ownership');
});
