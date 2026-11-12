// @vitest-environment happy-dom
// TEMPLATE-E2E TE-ENG12: the Template's placement keeps its authored slug (`_template`) but its cook publishes the
// recorded programs under the product slug, so the page asked for `/programs/_template.json` and logged a 404.
import {expect, test} from 'vitest';
import {entryProgramsURL} from '../src/client/game/boot/spawnDownload';

const CDN = 'https://packs.example.test/';
function bank(fields: Record<string, unknown>): void {
  document.getElementById('boot-module-files')?.remove();
  const script = document.createElement('script');
  script.type = 'application/json'; script.id = 'boot-module-files'; script.textContent = JSON.stringify(fields);
  document.head.append(script);
}

test('an authored `_template` reads the product file, never `_template.json`', () => {
  bank({});
  expect(entryProgramsURL('_template')).toBe(new URL('programs/template.json', document.baseURI).href);
  expect(entryProgramsURL('pine-hollow')).toBe(new URL('programs/pine-hollow.json', document.baseURI).href);
  bank({contentBase: CDN});
  expect(entryProgramsURL('_template')).toBe(`${CDN}programs/template.json`);
});

test('a cook that published no programs file asks for none, under either spelling', () => {
  bank({entryPrograms: {template: false}});
  expect(entryProgramsURL('_template')).toBeNull();
  expect(entryProgramsURL('template')).toBeNull();
  bank({entryPrograms: {template: true}, spawnManifests: {home: {shards: ['_template'], base: 'https://home.test/'}}});
  expect(entryProgramsURL('_template')).toBe('https://home.test/programs/template.json');
  bank({spawnManifests: {home: {shards: ['template'], base: 'https://home.test/'}}});
  expect(entryProgramsURL('_template')).toBe('https://home.test/programs/template.json');
});
