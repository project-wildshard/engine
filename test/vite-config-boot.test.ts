import { expect, test } from 'vitest';
import { loadConfigFromFile } from 'vite';
// oxlint-disable-next-line import/no-nodejs-modules -- The build's own loader, as the build starts it.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove the real Node config-loader fixture.
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Import the actual build helper from the fixture config.
import { resolve } from 'node:path';

test('the bundled Vite generator config imports discovery without loading the product builder', async () => {
  mkdirSync('tmp/vite-config-boot', { recursive: true });
  const root = mkdtempSync(resolve('tmp/vite-config-boot/discovery-'));
  try {
    const path = resolve(root, 'vite.config.ts');
    writeFileSync(path, `import * as generator from ${JSON.stringify(resolve('scripts/app-build/gen.ts'))}; export default { define: { GENERATOR_EXPORTS: JSON.stringify(Object.keys(generator).sort()) } };`);
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, path, root, 'silent', undefined, 'bundle');
    expect(loaded?.config.define?.['GENERATOR_EXPORTS']).toBe(JSON.stringify([
      'assetIndex', 'assetVersionRows', 'audioTableSource',
      'bootTableSources', 'bootTransportTableSources', 'changedContentNamed', 'generateBootTables',
    ]));
    expect(loaded?.dependencies.some(file => /(?:build-shardfiles|bake-data-maps|gen-programs)\.mjs$/u.test(file))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// The build reads these through the loader that takes the format package's TypeScript (`build-app.mjs`), never a Vite config.
function bootFacts(module: string, name: string): string {
  mkdirSync('tmp/vite-config-boot', { recursive: true });
  const root = mkdtempSync(resolve('tmp/vite-config-boot/facts-'));
  try {
    const script = `const { ${name} } = await import(${JSON.stringify(resolve(module))}); console.log(JSON.stringify(${name}(${JSON.stringify(root)})));`;
    const run = spawnSync(process.execPath, ['--no-warnings', '--import', './scripts/bake-loader.mjs', '--input-type=module', '-e', script], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    return run.stdout.trim();
  } finally { rmSync(root, { recursive: true, force: true }); }
}

test('the build computes tier facts in plain Node, with no page runtime state', () => {
  expect(bootFacts('scripts/app-build/bootFolderTiers.ts', 'bootTierFolderTotals')).toBe('{}');
});

test('the build reads boot facts in plain Node, with no runtime format graph', () => {
  expect(bootFacts('scripts/app-build/bootFolders.ts', 'bootFolderTotals')).toBe('{}');
});
