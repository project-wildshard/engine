import { expect, test } from 'vitest';
import { platformFileFamily, validatePlatformFile } from '@wildshard/format/platformFileFamilies';
import { SceneDressingSchema, SceneScatterPageSchema } from '@wildshard/format/sceneDressing';

const scatterSource = '@wildshard/format/sceneDressing#SceneScatterPageSchema';
const dressingSource = '@wildshard/format/sceneDressing#SceneDressingSchema';
const pose = { x: 1, y: 2, z: 3, yaw: .1, sx: 1, sy: 2, sz: 3, far: 40, r: .3, g: .4, b: .5 };

test('G1004 admits exactly the two complete native scatter pages without rewriting poses', () => {
  const page = { version: 1, members: [{ id: 'boulder', kind: 'poses', rows: [pose] }] };
  for (const name of ['world/dressing-pages/0.json', 'world/dressing-pages/1.json']) {
    const before = JSON.stringify(page);
    expect(platformFileFamily(name, scatterSource)?.schema).toBe(SceneScatterPageSchema);
    expect(platformFileFamily(name, scatterSource)?.reader).toBe('src/game/shardfile/sceneScatterPages.ts');
    expect(validatePlatformFile(name, scatterSource, page)).toBeDefined();
    expect(JSON.stringify(page)).toBe(before);
    for (const value of [{ ...page, extra: true }, { ...page, members: [...page.members, ...page.members] },
      { version: 1, members: [{ id: 'boulder', kind: 'poses', rows: [{ ...pose, x: Infinity }] }] },
      { version: 1, members: [{ id: 'boulder', kind: 'poses', rows: [{ ...pose, callback: () => 1 }] }] }]) {
      expect(() => validatePlatformFile(name, scatterSource, value)).toThrow();
    }
    expect(platformFileFamily(name, dressingSource)).toBeUndefined();
    expect(platformFileFamily(name, undefined)).toBeUndefined();
  }
  for (const name of ['world/dressing-pages/2.json', 'world/dressing-pages/private.json', 'private/dressing-pages/0.json']) {
    expect(platformFileFamily(name, scatterSource)).toBeUndefined();
  }
});

test('G1004 admits both whole dressing books while retaining native reference and unknown-field refusals', () => {
  const book = { name: 'meadow', instances: [], staticModels: [], catalogues: [], packs: {}, geometry: {}, materials: {}, layers: [], statics: [], animations: [] };
  for (const name of ['world/dressing-phone.json', 'world/dressing-desktop.json']) {
    const before = JSON.stringify(book);
    expect(platformFileFamily(name, dressingSource)?.schema).toBe(SceneDressingSchema);
    expect(platformFileFamily(name, dressingSource)?.reader).toBe('src/game/shardfile/sceneDressing.ts');
    expect(validatePlatformFile(name, dressingSource, book)).toBeDefined();
    expect(JSON.stringify(book)).toBe(before);
    expect(() => validatePlatformFile(name, dressingSource, { ...book, missingOwner: true })).toThrow();
    expect(() => validatePlatformFile(name, dressingSource, { ...book, geometry: { rock: { kind: 'packed', source: 'missing', key: 'rock' } } })).toThrow();
    expect(() => validatePlatformFile(name, dressingSource, { ...book, animations: [{ look: 'wind', timeParam: 'time', windParam: 'wind', windScale: Infinity, windMax: 1 }] })).toThrow();
    expect(platformFileFamily(name, scatterSource)).toBeUndefined();
  }
  expect(platformFileFamily('world/dressing-private.json', dressingSource)).toBeUndefined();
});
