// oxlint-disable-next-line import/no-nodejs-modules -- The check reads the committed first-paint script.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { arrivalArt } from '../src/client/engine/boot/titleArrival';
import { gridDestination } from '../src/client/game/grid/pageEntry';

const card = (portrait: string): { thumb: string; portrait: string; landscape: string } => ({ thumb: '', portrait, landscape: '' });
const home = { name: 'Driftwood Isle', card: card('/assets/title/driftwood-isle-portrait.jpg') };
const rows = new Map([['open-plot-ember-forge', { name: 'Ember Forge', card: card('/assets/title/open-plot-ember-forge-portrait.jpg') }],
  ['open-plot-thin-ice', { name: 'Thin Ice', card: card('') }]]);

test('LS6 (J190): a grid tap with a saved place shows that cell; a fresh save shows the home', () => {
  const find = (slug: string): typeof home | undefined => rows.get(slug);
  expect(gridDestination({ slug: 'open-plot-ember-forge' }, home, find)).toEqual({ name: 'Ember Forge', art: '/assets/title/open-plot-ember-forge-portrait.jpg' });
  expect(gridDestination(null, home, find)).toEqual({ name: 'Driftwood Isle', art: '/assets/title/driftwood-isle-portrait.jpg' });
  // no art of its own: none, never the home's art under another place's name
  expect(gridDestination({ slug: 'open-plot-thin-ice' }, home, find)).toEqual({ name: 'Thin Ice', art: '' });
  expect(gridDestination({ slug: 'open-plot-sky-race' }, home, find)).toEqual({ name: 'open plot sky race', art: '' });
});

test('LS6: arrival art is a same-origin asset path, and the first-paint script applies the same rule', () => {
  const line = readFileSync('index.html', 'utf8').split('\n').find(text => text.includes('.test(found.art)')) ?? '';
  const inline = /(\/\^.*\$\/)u\.test\(found\.art\)/u.exec(line)?.[1] ?? '';
  const first = new RegExp(inline.slice(1, -1), 'u');
  for (const ok of ['', '/assets/title/a-portrait.jpg', '/b/x/y.webp']) { expect(arrivalArt(ok)).toBe(true); expect(first.test(ok)).toBe(true); }
  for (const bad of ['https://evil.test/a.jpg', '//evil.test/a.jpg', '/a.jpg") ; x', 'data:image/png;base64,AA']) {
    expect(arrivalArt(bad)).toBe(false); expect(first.test(bad)).toBe(false);
  }
});
