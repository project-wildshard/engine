// ENGINE-MEMORY EM26 (meta docs/plans/ENGINE-MEMORY-PLAN.md, design rule 7): shard textures on the phone tier load as
// KTX2 whenever the shard has a KTX2 set, whatever its tier's texture policy says; desktop keeps the policy.
import { afterEach, expect, test } from 'vitest';
import { setAutoKtx2Check, setTexturePolicy, texModeWhy } from '../src/client/engine/boot/gpuFiles';
import { initializeTier } from '../src/client/engine/core/tier';

afterEach(() => { initializeTier('desktop'); setAutoKtx2Check(() => false); });

test('the phone loads a shard with a KTX2 set as KTX2 even when its tier asks for images', () => {
  initializeTier('phone');
  setAutoKtx2Check(slug => slug === 'nine-dragon-stack');
  setTexturePolicy('img', 'nine-dragon-stack');
  expect(texModeWhy()).toEqual({ mode: 'ktx2', why: 'auto: level tier texture policy; phone: nine-dragon-stack has a KTX2 set (EM26)' });
  // no KTX2 set: images stay (a sharddev check names the zone; EM26's row)
  setTexturePolicy('img', 'open-plot-thin-ice');
  expect(texModeWhy().mode).toBe('img');
});

test('desktop keeps its tier policy', () => {
  initializeTier('desktop');
  setAutoKtx2Check(() => true);
  setTexturePolicy('img', 'nine-dragon-stack');
  expect(texModeWhy()).toEqual({ mode: 'img', why: 'auto: level tier texture policy' });
});
