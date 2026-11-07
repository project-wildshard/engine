// oxlint-disable-next-line import/no-nodejs-modules -- Run the installed lint gate against owned diagnostic fixtures.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the real dependency pins; fixtures live under tmp and are removed.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the actual config and binary rather than relying on PATH.
import { resolve } from 'node:path';
import * as v from 'valibot';
import { expect, test } from 'vitest';

test('both installed lint tools are exact manifest pins, without upgrading the toolchain', () => {
  const dependency = v.object({ version: v.string() });
  const manifest = v.parse(v.object({ devDependencies: v.record(v.string(), v.string()) }), JSON.parse(readFileSync('package.json', 'utf8')));
  for (const tool of ['oxlint', 'oxlint-tsgolint']) {
    const pin = manifest.devDependencies[tool];
    expect(pin).toMatch(/^\d+\.\d+\.\d+$/u);
    const installed = v.parse(dependency, JSON.parse(readFileSync(`node_modules/${tool}/package.json`, 'utf8')));
    expect(pin).toBe(installed.version);
  }
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
