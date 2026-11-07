// oxlint-disable-next-line import/no-nodejs-modules -- Own source, sealed receipts and products in tiny scratch fixtures.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep fixture paths inside repository scratch.
import { dirname, resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { emitProgramTables, generationPlan, programDiscoveryProducts, programInputPlan } from '../scripts/gen-programs.mjs';
import { captureProductInputs, productInputKey, productToolchainKey, publishProductInputs, recordBundle } from '../scripts/shardfile-inputs.mjs';
import { productRecipe } from '../scripts/built-product.mjs';
import { InputHashMemo } from '../scripts/bake-input-hashes.mjs';
import { shardfileValidationRevision } from '../scripts/shardfile-validation-revision.mjs';
import { readProgramDiscovery, usesProgramDiscovery } from '../scripts/program-discovery.mjs';
import { authoredManifestSource } from '../scripts/authored-manifest.mjs';
import { emptyShardfile } from '../src/shared/host/author';
import { writeOutputProduct } from '../src/sharddev/outputProduct';
import { readProjectAssets } from '../src/sharddev/project';

const owned: string[] = [];
afterEach(() => { for (const root of owned.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(actualProduct = false) {
  mkdirSync('tmp', { recursive: true }); const root = mkdtempSync(resolve('tmp/discovery-bootstrap-')); owned.push(root);
  const cacheRoot = resolve(root, 'cache'), options = { cacheRoot, env: {} };
  const put = (file: string, text: string): void => { const path = resolve(root, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); };
  for (const file of ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']) put(file, '{}');
  put('node_modules/@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm', 'installed-physics-byte-identity');
  const manifest = { slug: 'alpha', card: {}, sky: {}, minimap: {}, explore: {}, horizonStrips: [], bindings: { accent: '#123456', budgets: { program: true } } };
  put('src/shards/alpha/manifest.json', JSON.stringify(manifest));
  const source = emptyShardfile({ slug: 'alpha', name: 'Alpha', author: 'Test', revision: 1, seed: 1 });
  put('src/shards/alpha/shard.config.ts', actualProduct
    ? `export function generate() { return {shard:${JSON.stringify(source)},output:{},discovery:{budgets:{}}}; } export default generate;`
    : 'export async function generate() {}');
  put('src/shards/beta/shard.config.ts', 'export default {};');
  put('src/shards/beta/manifest.json', '{}');
  const build = async (): Promise<number> => {
    const memo = new InputHashMemo(root);
    const toolchain = `${productToolchainKey(root, memo)}:${shardfileValidationRevision(root)}`;
    const { recipe, receipts } = productRecipe(root, 'alpha', ['--copy-runtime'], toolchain, cacheRoot);
    const receipt = resolve(root, 'receipt.json');
    await captureProductInputs(root, receipt, async () => {
      readFileSync(resolve(root, 'src/shards/alpha/shard.config.ts'));
      readFileSync(resolve(root, 'src/shards/alpha/manifest.json'));
      recordBundle({ output: [] }); await Promise.resolve();
    });
    const key = productInputKey(root, receipt, recipe, memo); if (key === undefined) throw new Error('Missing complete input receipt');
    const output = resolve(root, 'out/alpha');
    rmSync(output, { recursive: true, force: true });
    const built = actualProduct ? await readProjectAssets(resolve(root, 'src/shards/alpha')) : undefined;
    writeOutputProduct(built?.shard ?? source, built?.assets ?? new Map(), output, built?.output ?? { discovery: { budgets: {} } });
    put('out/alpha/.build-key', key); publishProductInputs(receipts, receipt, key);
    return 1;
  };
  const writeTables = async (): Promise<void> => {
    const discovery = readProgramDiscovery(root, 'alpha', options);
    put('src/shards/alpha/discovery.generated.ts', authoredManifestSource(root, 'alpha', { discovery }));
    await Promise.resolve();
  };
  return { root, put, options, manifest, build, writeTables };
}

test('cold inputs-only generation builds the required product before emitting discovery', async () => {
  const f = fixture(true), order: string[] = [];
  expect(() => readProgramDiscovery(f.root, 'alpha', f.options)).toThrow('Missing current product');
  expect(existsSync(resolve(f.root, 'public/assets/physics/rapier.wasm'))).toBe(false);
  await emitProgramTables(f.root, generationPlan(f.root, 'beta'), { inputsOnly: true,
    build: (root, plan, reuse) => {
      expect(root).toBe(f.root); expect(plan.products).toEqual(['alpha']); expect(reuse).toBe(true);
      expect(readFileSync(resolve(root, 'public/assets/physics/rapier.wasm')).equals(readFileSync(resolve(root, 'node_modules/@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm')))).toBe(true);
      order.push('product'); return f.build();
    }, writeTables: async () => { order.push('tables'); await f.writeTables(); },
  });
  expect(order).toEqual(['product', 'tables']);
  expect(readFileSync(resolve(f.root, 'src/shards/alpha/discovery.generated.ts'), 'utf8')).toContain('budgets: {}');
});

for (const file of ['shard.config.ts', 'manifest.json']) {
  test(`changed ${file} cannot grant discovery through an old receipt`, async () => {
    const f = fixture(); await f.build(); await f.writeTables();
    f.put(`src/shards/alpha/${file}`, file === 'manifest.json' ? JSON.stringify({ ...f.manifest, bindings: { ...f.manifest.bindings, accent: '#654321' } }) : 'export async function generate() { return 2; }');
    expect(() => readProgramDiscovery(f.root, 'alpha', f.options)).toThrow('Missing current product');
    await expect(emitProgramTables(f.root, generationPlan(f.root), { inputsOnly: true, build: () => Promise.resolve(0), writeTables: f.writeTables })).rejects.toThrow('Missing current product');
    await emitProgramTables(f.root, generationPlan(f.root), { inputsOnly: true, build: f.build, writeTables: f.writeTables });
    expect(readProgramDiscovery(f.root, 'alpha', f.options)).toEqual({ budgets: {} });
  });
}

test('a failed prerequisite never enters the discovery or boot table pass', async () => {
  const f = fixture(); let writes = 0;
  await expect(emitProgramTables(f.root, generationPlan(f.root), { inputsOnly: true,
    build: () => Promise.reject(new Error('Product refused')), writeTables: async () => { writes++; await Promise.resolve(); },
  })).rejects.toThrow('Product refused');
  expect(writes).toBe(0);
});

test('normal and scoped generation build every required product once', async () => {
  const f = fixture(), order: string[] = [];
  for (const requested of [undefined, 'beta']) {
    await emitProgramTables(f.root, generationPlan(f.root, requested), { inputsOnly: false,
      build: (_root, plan, reuse) => { order.push('product'); expect([...plan.products].sort()).toEqual(['alpha', 'beta']); expect(reuse).toBe(false); return f.build(); },
      writeTables: async () => { order.push('tables'); await f.writeTables(); },
    });
  }
  expect(order).toEqual(['product', 'tables', 'product', 'tables']);
});

test('ordinary manifests keep their original inputs-only and normal ordering', async () => {
  const f = fixture(), order: string[] = [];
  f.put('src/shards/alpha/manifest.json', '{}');
  for (const inputsOnly of [true, false]) await emitProgramTables(f.root, generationPlan(f.root), { inputsOnly,
    build: () => { order.push('product'); return Promise.resolve(1); }, writeTables: async () => { order.push('tables'); await Promise.resolve(); },
  });
  expect(order).toEqual(['tables', 'tables', 'product']);
});

test('composed output markers are discovered without executing source or accepting executable slots', () => {
  const f = fixture();
  f.put('src/shards/beta/outputs.json', JSON.stringify({ outputs: [{ slug: 'beta-one', manifest: { bindings: { boot: { files: { program: true } } } } }, { slug: 'beta-two' }] }));
  expect(programDiscoveryProducts(f.root)).toEqual(['alpha', 'beta-one']);
  expect(usesProgramDiscovery({ bindings: { entry: { program: true }, load: { program: true } } })).toBe(false);
});

test('a scoped request prepares the remaining producer inputs of global discovery prerequisites', () => {
  const f = fixture();
  const selected = generationPlan(f.root, 'beta');
  expect(selected.folders).toEqual(['beta']);
  const inputs = programInputPlan(f.root, selected);
  expect(inputs.products).toEqual(['beta', 'alpha']);
  expect(inputs.folders).toEqual(['alpha', 'beta']);
});

test('a corrupt newly built receipt refuses before any table is published', async () => {
  const f = fixture();
  await expect(emitProgramTables(f.root, generationPlan(f.root), { inputsOnly: true,
    build: async () => { await f.build(); f.put('out/alpha/validation.json', '{}'); return 1; }, writeTables: f.writeTables,
  })).rejects.toThrow();
  expect(() => readFileSync(resolve(f.root, 'src/shards/alpha/discovery.generated.ts'))).toThrow();
});
