import { expect, test } from 'vitest';
import { nalatiAmbientObservation } from './fixtures/nalati-ambient-observation';
import original from './fixtures/nalati-ambient-original.json' with { type: 'json' };

test('the owned loft compiler retains every original ambient channel, bound and topology bit', () => {
  expect(nalatiAmbientObservation()).toEqual(original);
});
