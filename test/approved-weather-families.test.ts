import { expect, test } from 'vitest';
import { platformFileFamily, validatePlatformFile } from '@wildshard/format/platformFileFamilies';
import { registeredJsonContract } from '@wildshard/format/registeredJson';

const fx = {
  shapes: { drop: { metadata: { version: 4.7, type: 'BufferGeometry', generator: 'BufferGeometry.toJSON' },
    type: 'BufferGeometry', data: { attributes: { position: { itemSize: 3, type: 'Float32Array', array: [0, 0, 0], normalized: false } } } } },
  noise: [0, 0.5, 1],
};
const bake = { url: '/assets/rain.bin', rows: { bytes: 0, geometries: [] } };
const rain = {
  name: 'rain', look: { coverN: 8, streaks: { phone: 1, desktop: 2 }, splashes: { phone: 1, desktop: 2 }, lensDrops: { phone: 1, desktop: 2 } },
  programs: { rain: 'rain', splash: 'splash', lens: 'lens', channels: 'weather' }, cover: { page: 'forest', roofs: [] },
  water: { look: 'puddle', name: 'puddle', renderOrder: 2 }, rings: ['puddle'], bake: { phone: bake, desktop: bake },
};
const observations = { page: 'forest', audio: 'ambience', guide: 'guide' };
const cases = [
  { name: 'world/weather-fx.json', value: fx, malformed: { ...fx, noise: [Number.NaN] } },
  { name: 'world/rain.json', value: rain, malformed: { ...rain, cover: { roofs: [] } } },
  { name: 'world/weather-observations.json', value: observations, malformed: { page: 'forest', audio: 'ambience' } },
] as const;

test('G1004 admits only the three approved complete weather documents without rewriting them', () => {
  for (const row of cases) {
    const contract = registeredJsonContract(row.name), before = JSON.stringify(row.value);
    expect(platformFileFamily(row.name, contract.source)?.schema).toBe(contract.schema);
    expect(validatePlatformFile(row.name, contract.source, row.value)).toBeDefined();
    expect(JSON.stringify(row.value)).toBe(before);
    expect(() => validatePlatformFile(row.name, contract.source, row.malformed)).toThrow();
    expect(platformFileFamily(row.name, undefined)).toBeUndefined();
    expect(platformFileFamily(row.name, `${contract.source}-private`)).toBeUndefined();
    expect(platformFileFamily(row.name.replace('.json', '-private.json'), contract.source)).toBeUndefined();
  }
});
