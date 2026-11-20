import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- the native runtime's material input list, read where it is built
import { readFileSync } from 'node:fs';

test('ONE-FORMAT OF23a: a native runtime reads its skin looks\' textures before compiling materials', () => {
  // clientMaterials compiles `skinTextureRefs(shard)`; runtimeLookMaterials must read the same refs into its inputs, or a
  // native runtime with skin looks (Pine's species rows) fails at level.world with a missing admitted texture
  const source = readFileSync(new URL('runtimeFolder.ts', import.meta.url), 'utf8');
  const start = source.indexOf('export async function runtimeLookMaterials'), body = source.slice(start, source.indexOf('\n}\n', start));
  expect(body).toMatch(/files\.set\(ref, await product\.assets\.read\(ref\)\)/u);
  expect(body).toContain('...skinTextureRefs(shard)');
});
