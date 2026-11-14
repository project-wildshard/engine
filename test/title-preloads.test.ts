// PZ18 (meta PAGE-SIZE): the built document preloads the grid page entry's static closure with the entry's own chunks.
import { expect, test } from 'vitest';
import { TITLE_PRELOAD_ROOT, titlePreloadFiles, withTitlePreloads } from '../scripts/app-build/titlePreloads.mjs';

const report = {
  'b/c/rolldown-runtime-a.js': { moduleIds: [], imports: [] },
  'b/c/shared-b.js': { moduleIds: ['src/client/engine/core/shared.ts'], imports: ['b/c/rolldown-runtime-a.js'] },
  'b/c/entry-3-c.js': { moduleIds: ['src/client/app/entry.ts'], imports: ['b/c/shared-b.js'] },
  'b/c/title-0-c-d.js': { moduleIds: [TITLE_PRELOAD_ROOT, 'src/client/game/mainMenu.ts'], imports: ['b/c/title-0-s-e.js', 'b/c/shared-b.js'] },
  'b/c/title-0-s-e.js': { moduleIds: ['src/client/engine/ui/StartTitle.ts'], imports: ['b/c/rolldown-runtime-a.js'] },
  'b/c/late-f.js': { moduleIds: ['src/client/game/session/session.ts'], imports: ['b/c/title-0-s-e.js'] },
};
const html = ['<!doctype html><html><head><script type="importmap">{"imports":{}}</script>',
  '<link rel="modulepreload" crossorigin href="/b/c/rolldown-runtime-a.js">',
  '<link rel="modulepreload" crossorigin href="/b/c/shared-b.js">',
  '<script type="module" crossorigin src="/b/c/entry-3-c.js"></script></head><body></body></html>'].join('\n');

test('the title closure is preloaded after the document\'s own preloads, each chunk once', () => {
  const files = titlePreloadFiles(report, html);
  expect(files).toEqual(['b/c/title-0-c-d.js', 'b/c/title-0-s-e.js']);
  const out = withTitlePreloads(html, files);
  const links = [...out.matchAll(/<link rel="modulepreload" crossorigin href="\/([^"]+)">/gu)].map(match => match[1]);
  expect(links).toEqual(['b/c/rolldown-runtime-a.js', 'b/c/shared-b.js', 'b/c/title-0-c-d.js', 'b/c/title-0-s-e.js']);
  // before the module script, after the import map
  expect(out.indexOf('title-0-s-e.js')).toBeLessThan(out.indexOf('<script type="module"'));
  expect(out.indexOf('importmap')).toBeLessThan(out.indexOf('title-0-c-d.js'));
  // a second pass adds nothing
  expect(titlePreloadFiles(report, out)).toEqual([]);
});

test('a build with no grid page entry changes nothing; a missing report row fails the build', () => {
  expect(titlePreloadFiles({ 'b/c/entry-3-c.js': { moduleIds: ['src/client/app/entry.ts'], imports: [] } }, html)).toEqual([]);
  expect(withTitlePreloads(html, [])).toBe(html);
  expect(() => titlePreloadFiles({ 'b/c/title-0-c-d.js': { moduleIds: [TITLE_PRELOAD_ROOT], imports: ['b/c/gone.js'] } }, html)).toThrow(/gone/u);
});
