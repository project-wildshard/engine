import { expect, test } from 'vitest';
import { registerGpuFiles, standIn } from '../src/client/engine/boot/gpuFiles';
import { TIER } from '../src/client/engine/core/tier';
import { cookedKtx2TableOf } from '../src/shared/game/shardfile/cookedKtx2Table';

// SF15 (J525): a shardfile carries images only and the cook writes the KTX2 table into its discovery document. The client
// registers that table and its image loader (`core/ktx2.ts` through `gpuFile`) reads the cooked KTX2 in a JPG's place; with
// KTX2 vetoed (images mode) `standIn` answers nothing and the JPG itself loads.
const JPG = '/assets/sf15-fixture/tex/leafy_grass/diffuse.jpg';
const DESKTOP = '/assets/sf15-fixture/tex/leafy_grass/diffuse-0123abcd.ktx2';
const PHONE = '/assets/sf15-fixture/tex/leafy_grass/diffuse-0123abcd.t512-89abcdef.ktx2';
const LAYER = '/assets/sf15-fixture/tex/leafy_grass/diffuse.layer-4567cdef.ktx2';
const discovery = {
  native: { ktx2: { $call: 'pageModeKtx2', args: [{
    shard: { phone: { [JPG]: PHONE, [`${JPG}#layer`]: LAYER }, desktop: { [JPG]: DESKTOP, [`${JPG}#layer`]: LAYER } },
    grid: { phone: {}, desktop: {} },
  }] } },
};
const table = cookedKtx2TableOf(discovery);
registerGpuFiles(table);
const cooked = TIER === 'phone' ? PHONE : DESKTOP;

test('the cooked table from a discovery document names the tier\'s KTX2 for the JPG', () => {
  expect(table.desktop[JPG]).toBe(DESKTOP);
  expect(table.phone[JPG]).toBe(PHONE);
  expect(standIn(JPG, 'ktx2')).toBe(cooked);
  expect(standIn(`${JPG}#layer`, 'ktx2')).toBe(LAYER);
});

test('with KTX2 vetoed the JPG itself loads', () => {
  expect(standIn(JPG, 'img')).toBeUndefined();
});
