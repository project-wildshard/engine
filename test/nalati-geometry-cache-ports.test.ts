import { expect, test } from 'vitest';
import { geometryCacheAuthorObservation } from './fixtures/geometry-cache-author-observation';
import original from './fixtures/geometry-cache-author-original.json' with { type: 'json' };

test('granite and ordinary/scrambled blobs retain all original geometry bits and stream state', () => {
  expect(geometryCacheAuthorObservation()).toEqual(original);
});
