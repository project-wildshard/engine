// @vitest-environment happy-dom
// TEMPLATE-E2E TE-ENG12: a `_` prototype's placement keeps its authored slug (`_proto`) but its cook publishes the
// recorded programs under the product slug (`proto`); the retired Template asked for its authored file and logged a 404.
import {expect, test} from 'vitest';
import {entryProgramsURL} from '../src/client/game/boot/spawnDownload';

const CDN = 'https://packs.example.test/';
function bank(fields: Record<string, unknown>): void {
  document.getElementById('boot-module-files')?.remove();
  const script = document.createElement('script');
  script.type = 'application/json'; script.id = 'boot-module-files'; script.textContent = JSON.stringify(fields);
  document.head.append(script);
}

test('an authored `_proto` reads the product file, never `_proto.json`', () => {
  bank({});
  expect(entryProgramsURL('_proto')).toBe(new URL('programs/proto.json', document.baseURI).href);
  expect(entryProgramsURL('pine-hollow')).toBe(new URL('programs/pine-hollow.json', document.baseURI).href);
  bank({contentBase: CDN});
  expect(entryProgramsURL('_proto')).toBe(`${CDN}programs/proto.json`);
});

test('a cook that published no programs file asks for none, under either spelling', () => {
  bank({entryPrograms: {proto: false}});
  expect(entryProgramsURL('_proto')).toBeNull();
  expect(entryProgramsURL('proto')).toBeNull();
  bank({entryPrograms: {proto: true}, spawnManifests: {home: {shards: ['_proto'], base: 'https://home.test/'}}});
  expect(entryProgramsURL('_proto')).toBe('https://home.test/programs/proto.json');
  bank({spawnManifests: {home: {shards: ['proto'], base: 'https://home.test/'}}});
  expect(entryProgramsURL('_proto')).toBe('https://home.test/programs/proto.json');
});
