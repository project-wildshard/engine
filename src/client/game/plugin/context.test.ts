import { expect, test } from 'vitest';
import { compiledPageBoot } from './context';
import { bootSourceFiles } from '@wildshard/engine/boot/filePolicy';
import { bootParts } from '@wildshard/engine/boot/pack';
import type { BootSpec } from '@wildshard/engine/level/spec';
import type { ChunkFiles } from '@wildshard/engine/boot/bytes';

test('compiled boot retains policy and admits no predecessor pack while preserving exact compiled inventory identity', () => {
  const blank: ChunkFiles = { sky: [], baked: [], terrain: [], trees: [], physics: [], cabins: [], props: [], art: [], music: [], sfx: [] };
  const raw = '/assets/old-world.glb';
  let oldReads = 0;
  const authored: BootSpec = { files: [raw], sources: () => { oldReads++; return { ...blank, props: [raw] }; },
    steps: { props: { label: 'World', weight: 3 } }, phone: { deferExtras: true }, barrier: true,
    audio: ['/assets/audio.m4a'], explore: { art: ['/assets/explore.webp'] } };
  const compiled: BootSpec = { files: [], sources: () => blank };
  const result = compiledPageBoot(authored, compiled);
  expect(result.files).toBe(compiled.files); expect(result.sources).toBe(compiled.sources);
  expect(result.steps).toBe(authored.steps); expect(result.phone).toBe(authored.phone);
  expect(result.explore).toBe(authored.explore); expect(result.audio).toBe(authored.audio); expect(result.barrier).toBe(true);
  if (result.sources === undefined) throw new Error('Missing sources');
  const files = bootSourceFiles(result.sources, 'phone', 'img');
  expect(bootParts({ parts: [{ url: '/assets/old-pack.bin', bytes: 4331588, files: [[raw, 0, 4331588, 'model/gltf-binary']] }],
    bytes: 4331588, files: [[raw, 0, 4331588, 'model/gltf-binary']] }, files).parts).toEqual([]);
  expect(oldReads).toBe(0);
  expect(bootSourceFiles(authored.sources ?? (() => blank), 'phone', 'img').props).toEqual([raw]);
  expect(oldReads).toBe(1);
  expect(() => compiledPageBoot(authored, undefined)).toThrow('admitted boot sources');
});
