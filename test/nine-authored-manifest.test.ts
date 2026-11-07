import { inputs } from './fixtures/nine-product-inputs';
import { bootDiscovery } from './fixtures/nine-boot-discovery';
import { expect, test } from 'vitest';
import { MANIFEST } from '../src/shards/nine-dragon-stack/discovery.generated';
import { authoredManifestSource } from '../scripts/authored-manifest.mjs';
import { parseDiscoveryValues } from '@wildshard/format/discoveryValues';
// oxlint-disable-next-line import/no-nodejs-modules -- Inspect the defining compiler output in this clean source tree.
import { resolve } from 'node:path';

test('Nine compiles a data-only entry without retired runtime imports', () => {
  expect(Object.hasOwn(MANIFEST, 'trustedRuntime')).toBe(false);
  expect(MANIFEST.clientPlanRuntime).toBe(true);
  const root = resolve(import.meta.dirname, '..');
  expect(() => authoredManifestSource(root, 'nine-dragon-stack')).toThrow('missing or invalid program discovery value boot.explore');
  const source = authoredManifestSource(root, 'nine-dragon-stack', { discovery: parseDiscoveryValues({ ...bootDiscovery, navigation: { ...inputs.navigation } }) });
  expect(source).not.toContain('navigation.generated');
  expect(source).toContain('.declaredClientPlanEntry(');
  expect(source).not.toContain('nativeModule');
  expect(source).not.toContain('./plugin');
  expect(source).not.toContain('./runtime/index');
});

test('each computed boot binding refuses an absent current-product value', () => {
  const root = resolve(import.meta.dirname, '..');
  for (const slot of ['poses', 'boot.files', 'boot.sources', 'boot.explore']) {
    const discovery: Record<string, unknown> = { ...bootDiscovery, navigation: { ...inputs.navigation } }; delete discovery[slot];
    expect(() => authoredManifestSource(root, 'nine-dragon-stack', { discovery: parseDiscoveryValues(discovery) })).toThrow(`missing or invalid program discovery value ${slot}`);
  }
  const source = authoredManifestSource(root, 'nine-dragon-stack', { discovery: parseDiscoveryValues({ ...bootDiscovery, navigation: { ...inputs.navigation } }) });
  for (const name of ['poses', 'files', 'sources', 'explore']) expect(source).not.toContain(`./boot/${name}.generated.json`);
});
