import { expect, test } from 'vitest';
import { hullMapName } from './riggedHulls';

// a KTX2 header's first 16 bytes: the identifier, then vkFormat (157 / 158 raw ASTC 4x4, 0 Basis)
const ktx2 = (vk: number): Uint8Array => {
  const bytes = new Uint8Array(80);
  bytes.set([0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a]);
  new DataView(bytes.buffer).setUint32(12, vk, true);
  return bytes;
};

test('a device with ASTC reads the phone map itself', () => {
  expect(hullMapName('models/creatures/elk-cow.phone.normal.ktx2', ktx2(157), true)).toBe('models/creatures/elk-cow.phone.normal.ktx2');
});

test('a device without ASTC reads a raw-ASTC phone map\'s Basis twin instead', () => {
  expect(hullMapName('models/creatures/elk-cow.phone.normal.ktx2', ktx2(157), false)).toBe('models/creatures/elk-cow.normal.ktx2');
  expect(hullMapName('models/creatures/bear-black.phone.bear.black-old.coat.ktx2', ktx2(158), false)).toBe('models/creatures/bear-black.bear.black-old.coat.ktx2');
});

test('a Basis map needs no twin; a raw-ASTC map with no phone twin name refuses', () => {
  expect(hullMapName('models/creatures/boar.phone.base.ktx2', ktx2(0), false)).toBe('models/creatures/boar.phone.base.ktx2');
  expect(hullMapName('models/creatures/boar.base.ktx2', ktx2(158), false)).toBeNull();
});
