// @vitest-environment happy-dom
import { expect, test, vi } from 'vitest';
import { configuredShardfile, preparePageResidency } from './clientSource';
import { parseShardSlug } from '../../../shared/game/shard/slug';
import type { FolderOptions } from './folder';
import { MemoryAdmission } from '@wildshard/format/memoryAdmission';
import { SHARDFILE_ADMISSION_LIMITS } from '@wildshard/format/admissionLimits';

function options(): FolderOptions {
  return { base: 'https://fixture.invalid/', firstParty: true, offline: false,
    fetch: vi.fn(() => Promise.reject(new Error('Unexpected network read'))),
    hash: vi.fn(() => Promise.reject(new Error('Unexpected hash read'))) };
}

test('ordinary discovery keeps the supplied page memory policy without allocating grid residency', () => {
  const memory = new MemoryAdmission(() => false);
  const page = preparePageResidency({ slug: parseShardSlug('source-fixture'), shardfile: '/shardfiles/source-fixture/shard.json' }, undefined, memory);
  expect(page).toEqual({ mode: 'shard', instance: null, memory });
});

test('the descriptor owner does not read content for ordinary first-party discovery', async () => {
  const input = options();
  await expect(configuredShardfile({ getElementById: () => null }, input)).resolves.toBeNull();
  expect(input.fetch).not.toHaveBeenCalled();
  expect(input.hash).not.toHaveBeenCalled();
});

test('embedded descriptor admission retains its size and format refusals before asset reads', async () => {
  const input = options(), element = document.createElement('script');
  element.textContent = ' '.repeat(SHARDFILE_ADMISSION_LIMITS.sourceBytes + 1);
  await expect(configuredShardfile({ getElementById: () => element }, input)).rejects.toThrow('exceeds admission cap');
  element.textContent = JSON.stringify({ version: 1, unadmitted: true });
  await expect(configuredShardfile({ getElementById: () => element }, input)).rejects.toThrow('requires a format-2 output');
  expect(input.fetch).not.toHaveBeenCalled();
  expect(input.hash).not.toHaveBeenCalled();
});
