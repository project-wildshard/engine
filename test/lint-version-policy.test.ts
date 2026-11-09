// oxlint-disable-next-line import/no-nodejs-modules -- Run the installed lint gate against owned diagnostic fixtures.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the real dependency pins; fixtures live under tmp and are removed.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the actual config and binary rather than relying on PATH.
import { resolve } from 'node:path';
import * as v from 'valibot';
import { expect, test } from 'vitest';

test('the library and native lint tool retain exact manifest pins', () => {
  const dependency = v.object({ version: v.string() });
  const manifest = v.parse(v.object({ devDependencies: v.record(v.string(), v.string()), binDependencies: v.record(v.string(), v.string()) }), JSON.parse(readFileSync('package.json', 'utf8')));
  const library = v.parse(dependency, JSON.parse(readFileSync('node_modules/oxlint/package.json', 'utf8')));
  expect(manifest.devDependencies['oxlint']).toMatch(/^\d+\.\d+\.\d+$/u);
  expect(library.version).toBe(manifest.devDependencies['oxlint']);
  const inventory = spawnSync(resolve('node_modules/.bin/npr'), ['ls', '--depth', '0', '--json'], { encoding: 'utf8', timeout: 5000 });
  expect(inventory.status, inventory.stdout + inventory.stderr).toBe(0);
  const rows = v.parse(v.array(v.object({ dependencies: v.record(v.string(), dependency) })), JSON.parse(inventory.stdout));
  const installed = rows.map(row => row.dependencies['oxlint-tsgolint']?.version).filter(version => version !== undefined);
  expect(manifest.binDependencies['oxlint-tsgolint']).toMatch(/^\d+\.\d+\.\d+$/u);
  expect(installed).toEqual([manifest.binDependencies['oxlint-tsgolint']]);
});

test('the main config excludes nursery diagnostics while stable errors still refuse', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/lint-policy-'));
  try {
    const config = resolve(root, '.oxlintrc.json');
    // Only disable type-aware execution for this JS fixture, just as fast lint
    // does. Categories, stable severity and curated rules inherit the real gate.
    writeFileSync(config, JSON.stringify({ extends: [resolve('.oxlintrc.json')], options: { typeAware: false } }));
    const file = resolve(root, 'fixture.js');
    const lint = () => spawnSync(resolve('node_modules/.bin/oxlint'), ['-c', config, '-f', 'json', '--threads=1', file], { encoding: 'utf8', timeout: 10_000 });
    writeFileSync(file, 'export const value = missingGlobal();\n'); // eslint/no-undef is nursery in the pinned release.
    const nursery = lint();
    expect(nursery.status, nursery.stdout + nursery.stderr).toBe(0);
    writeFileSync(file, 'export const value = 1;\ndebugger;\n');
    const stable = lint();
    expect(stable.status, stable.stdout + stable.stderr).toBe(1);
    expect(stable.stdout).toContain('no-debugger');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('the typed CLI keeps native diagnostics outside node_modules', () => {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/lint-native-')), file = resolve(root, 'probe.ts'), config = resolve(root, '.oxlintrc.json');
  try {
    writeFileSync(resolve(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'ES2023', module: 'ESNext' }, include: ['probe.ts'] }));
    writeFileSync(config, JSON.stringify({ categories: {}, options: { typeAware: true }, rules: { 'typescript/no-floating-promises': 'error' } }));
    const environment = { ...process.env }; delete environment['OXLINT_TSGOLINT_PATH'];
    const lint = (env = environment) => spawnSync(process.execPath, [resolve('scripts/lint-cli.mjs'), '-c', config, '--no-ignore', '--disable-nested-config', '--type-aware', '--threads', '1', file], { cwd: root, encoding: 'utf8', timeout: 5000, env });
    writeFileSync(file, 'export async function work():Promise<void>{}\nwork();\n');
    const floating = lint(); expect(floating.status, floating.stdout + floating.stderr).toBe(1); expect(floating.stdout).toContain('no-floating-promises');
    writeFileSync(file, 'export async function work():Promise<void>{}\nvoid work();\n');
    const handled = lint(); expect(handled.status, handled.stdout + handled.stderr).toBe(0);
    const missing = lint({ ...environment, OXLINT_TSGOLINT_PATH: resolve(root, 'missing-native') });
    expect(missing.status, missing.stdout + missing.stderr).toBe(1); expect(missing.stdout).toContain('OXLINT_TSGOLINT_PATH');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
