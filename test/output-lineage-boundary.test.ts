import { expect, test } from 'vitest';
import { build } from 'vite';

test('historical inventory and portable state bundle without current host validators', async () => {
  const entry = new URL('../output-lineage-boundary', import.meta.url).pathname;
  const result = await build({ configFile: false, logLevel: 'silent', plugins: [{ name: 'output-lineage-boundary',
    resolveId(id) { return id === entry ? '\0output-lineage-boundary' : null; },
    load(id) { return id === '\0output-lineage-boundary'
      ? `export {parseOutputLineageIndex,parseStateLineage,assertStateCompatibility} from '@wildshard/format/stateLineage';` : null; },
  }], build: { write: false, minify: false, lib: { entry, formats: ['es'] }, rolldownOptions: { output: { codeSplitting: false } } } });
  const built = Array.isArray(result) ? result[0] : result;
  if (built === undefined || !('output' in built)) throw new Error('Missing historical bundle');
  const chunks = built.output.filter(row => row.type === 'chunk');
  expect(chunks).toHaveLength(1);
  const modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
  for (const name of ['outputIndex', 'shardSchema', 'product', 'assetAdmission', 'scriptAdmission']) {
    expect(modules.some(id => id.endsWith(`/src/format/${name}.ts`)), name).toBe(false);
  }
  const code = chunks.map(chunk => chunk.code).join('\n');
  expect(code).toContain('Missing historical state section');
  expect(code).toContain('State revisions cannot move backwards');
});
