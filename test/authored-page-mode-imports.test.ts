import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the existing authored emitter fixture.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only that defining fixture.
import { resolve } from 'node:path';
import { parseManifestMetadata } from '@wildshard/format/minimap';
import { authoredManifestSource } from '../scripts/authored-manifest.mjs';

const root = resolve(import.meta.dirname, '..');
const fixture = parseManifestMetadata(JSON.parse(readFileSync(resolve(root, 'src/shards/_template/manifest.json'), 'utf8')));
const { boot: _boot, ktx2: _ktx2, ...bindings } = fixture.bindings;
const boot = { platform: 'page-mode', rows: { module: './data/boot.generated.json', export: 'default' } };
const ktx2 = { platform: 'page-mode', rows: { module: './data/gpu.generated.json', export: 'default' } };

test('boot and KTX2 share their already eager helper without a fake dynamic edge', () => {
  const data = parseManifestMetadata({ ...fixture, bindings: { ...bindings, boot, ktx2 } });
  const source = authoredManifestSource(root, fixture.slug, { metadataOnly: true, composed: data });
  expect(source).toContain("import { pageModeBoot, pageModeKtx2 } from '@wildshard/engine/game/shard/pageBoot';");
  expect(source).toContain('bootBindings: pageModeBoot(');
  expect(source).toContain('ktx2: async () => pageModeKtx2((await import("./data/gpu.generated.json", { with: { type: \'json\' } })).default)');
  expect(source).not.toContain("import('@wildshard/engine/game/shard/pageBoot')");
});

test('KTX2 alone keeps a valid lazy helper and boot alone imports no KTX2 mapper', () => {
  const onlyKtx = authoredManifestSource(root, fixture.slug, { metadataOnly: true,
    composed: parseManifestMetadata({ ...fixture, bindings: { ...bindings, ktx2 } }) });
  expect(onlyKtx).toContain("(await import('@wildshard/engine/game/shard/pageBoot')).pageModeKtx2");
  expect(onlyKtx).not.toContain("from '@wildshard/engine/game/shard/pageBoot'");
  const onlyBoot = authoredManifestSource(root, fixture.slug, { metadataOnly: true,
    composed: parseManifestMetadata({ ...fixture, bindings: { ...bindings, boot } }) });
  expect(onlyBoot).toContain("import { pageModeBoot } from '@wildshard/engine/game/shard/pageBoot';");
  expect(onlyBoot).not.toContain('pageModeKtx2');
});
