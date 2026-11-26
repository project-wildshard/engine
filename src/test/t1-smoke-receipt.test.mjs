import { expect, test } from 'vitest';

import { bootLeaves } from '../e2e/t1/smoke-receipt.ts';

const span = (operation, start, end) => ({ operation, start, end });

test('TB-4b: a stage leaf is its own time, less the stages and decodes inside it, in quarter seconds', () => {
  const leaves = bootLeaves([
    span('stage:finish', 1000, 7000),
    span('stage:home', 1000, 5000),
    span('stage:firstFrame', 6000, 6600),
    span('wait:GLTF decode brasscap/a.glb', 2000, 2400),
    span('wait:GLTF decode brasscap/b.glb', 2200, 3000),
    span('texture:decode sand.ktx2', 8000, 8100),
    span('stage:menu', 200, 300),
  ]);
  // Finish: 6 s less home 4 s and firstFrame 0.6 s; home 4 s less 1 s of overlapping decodes; menu under a quarter second
  expect(leaves).toEqual({ finish: 1250, home: 3000, firstFrame: 500, packDecode: 1000 });
});

test('TB-4b: the decode leaf is always recorded, so a planted decode grows from a zero baseline', () => {
  expect(bootLeaves([span('stage:home', 0, 2000)])).toEqual({ home: 2000, packDecode: 0 });
});
