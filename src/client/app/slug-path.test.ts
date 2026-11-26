import { expect, test } from 'vitest';
import { currentSlug, retiredSlugs, slugOfPath, slugPathOf } from './slugPath';
import { adoptSlugAliases } from '@wildshard/engine/game/slugNames';

// OF31i4: the retired slug is world data; the placement file lays it in (as the box and page do)
adoptSlugAliases({ 'blender-template': 'brasscap-mesa' });

/** SA36: the entry opens the slug page for exactly the paths pages/worker.ts serves it on (test/page-workers.test.ts). */
test('only /slug/<slug> names a slug', () => {
  expect(['/slug/driftwood-isle', '/slug/open-plot-thin-ice/', '/slug/_proto'].map(slugOfPath)).toEqual(['driftwood-isle', 'open-plot-thin-ice', '_proto']);
  expect(['/', '/slug/', '/slug/a/b', '/slugs/x', '/doctor/', '/slug/a%20b'].map(slugOfPath)).toEqual([null, null, null, null, null, null]);
});

test('Brasscap Mesa is brasscap-mesa: its retired slug blender-template reads as the new one (TC-SHIP-a)', () => {
  expect(slugOfPath('/slug/brasscap-mesa')).toBe('brasscap-mesa');
  expect(slugOfPath('/slug/blender-template')).toBe('brasscap-mesa');
  expect(slugPathOf('brasscap-mesa')).toBe('/slug/brasscap-mesa');
  expect(slugPathOf('blender-template')).toBe('/slug/brasscap-mesa');
  expect(retiredSlugs()).toEqual([['blender-template', 'brasscap-mesa']]);
  expect([currentSlug('blender-template'), currentSlug('brasscap-mesa'), currentSlug('driftwood-isle')]).toEqual(['brasscap-mesa', 'brasscap-mesa', 'driftwood-isle']);
  expect(slugPathOf('driftwood-isle')).toBe('/slug/driftwood-isle');
  // Ring 1's catalogue lists blender-template, the format's own Template 2: an old link to it stays itself
  expect(currentSlug('blender-template', slug => slug === 'blender-template')).toBe('blender-template');
});
