import { expect, test } from 'vitest';
import { build } from 'vite';

test('live device costs bundle without offline product validators', async () => {
  const entry = new URL('../device-cost-boundary', import.meta.url).pathname;
  const result = await build({ configFile: false, logLevel: 'silent', plugins: [{ name: 'device-cost-boundary',
    resolveId(id) { return id === entry ? '\0device-cost-boundary' : null; },
    load(id) { return id === '\0device-cost-boundary'
      ? `import {acceptValidatedCost,deviceLibraryCostSteps,textureLibrarySource} from '@wildshard/format/deviceMemoryCost';
         import {parseKtx2} from '@wildshard/format/ktx2Cost';
         export {acceptValidatedCost,deviceLibraryCostSteps,textureLibrarySource,parseKtx2};` : null; },
  }], build: { write: false, minify: false, lib: { entry, formats: ['es'] }, rolldownOptions: { output: { codeSplitting: false } } } });
  const built = Array.isArray(result) ? result[0] : result;
  if (built === undefined || !('output' in built)) throw new Error('Missing device-cost bundle');
  const chunks = built.output.filter(row => row.type === 'chunk');
  expect(chunks).toHaveLength(1);
  const modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
  for (const name of ['assetAdmission', 'product', 'shardSchema', 'outputIndex', 'scriptAdmission']) {
    expect(modules.some(id => id.endsWith(`/src/format/${name}.ts`)), name).toBe(false);
  }
  const code = chunks.map(chunk => chunk.code).join('\n');
  expect(code).toContain('Missing admitted texture cost bytes');
  expect(code).toContain('KTX2 mip range');
});
