// oxlint-disable-next-line import/no-nodejs-modules -- Read one tracked Blender output.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { parseGlbData, prepareGlbCost } from '@wildshard/format/glbCost';
import type { GlbVertex } from '@wildshard/format/glbTriangles';

// iPhone downloads I8.4: Driftwood's spawn cove (gltfpack output) stores normalized Int16 positions that its nodes
// dequantize (KHR_mesh_quantization). The cost reader admits them and reads them as fractions of the node scale.
test('normalized Int16 positions are admitted and placed by their node scale', async () => {
  await prepareGlbCost();
  const bytes = Uint8Array.from(readFileSync('public/assets/models/driftwood-blender/island.glb'));
  let triangles = 0, far = 0;
  const cost = parseGlbData(bytes, (triangle: readonly GlbVertex[]) => {
    triangles++;
    for (const p of triangle) far = Math.max(far, Math.abs(p.x), Math.abs(p.z));
  });
  expect(cost.triangles).toBeGreaterThan(0);
  expect(triangles).toBe(cost.triangles);
  // inside the 500 m cell (raw Int16 steps would put the island ~32,767 x further out)
  expect(far).toBeGreaterThan(10);
  expect(far).toBeLessThan(400);
});
