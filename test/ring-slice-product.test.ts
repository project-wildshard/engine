// Ring 2: this consumer proof deliberately needs the complete pin and its server slice.
// Ring 1 gameplay suites read only their installed slices.
// oxlint-disable-next-line import/no-nodejs-modules -- Expand one actual immutable pin into an owned fixture root.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine fixture metadata and bodies to repository scratch.
import {dirname, resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Locate the immutable public pin installed before every suite.
import {homedir} from 'node:os';
import {readTar} from '@wildshard/format/tar';
import {expect, test} from 'vitest';
import {readBuiltShardfile} from '../src/scripts/built-folder.mjs';
import {openShardfile, serverRows} from '../src/cook/game/shardCook';
import {loadHeadlessFolder} from '../src/server/host/headlessFolder';
import {createNativeHeadlessResident} from '../src/server/host/headlessRuntime';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {leadPlayer} from '../src/shared/engine/sim/leadPlayer';
import {runtimeAssets} from './fixtures/engine-lift/folder';

test('a Ring 1 consumer walks the actual slice and refuses its loss despite a complete product beside it', async () => {
  mkdirSync('tmp', {recursive: true});
  const root = mkdtempSync(resolve('tmp/ring-slice-'));
  const slug = 'driftwood-isle', slice = resolve(root, 'out/.slices', slug), full = resolve(root, 'out', slug);
  let resident: Awaited<ReturnType<typeof createNativeHeadlessResident>> | undefined;
  try {
    mkdirSync(resolve(root, 'test/pins'), {recursive: true});
    writeFileSync(resolve(root, 'test/pins/rings.json'), readFileSync('test/pins/rings.json'));
    const pins = JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as {shards: {slug: string; hash: string}[]};
    const pin = pins.shards.find(row => row.slug === slug);
    if (pin === undefined) throw new Error('Missing actual Driftwood pin');
    const bytes = readFileSync(resolve(process.env['WILDSHARD_PIN_CACHE'] ?? resolve(homedir(), '.cache/wildshard/pins'), `${pin.hash}.tar`));
    const write = (folder: string, path: string, body: Uint8Array): void => {
      const file = resolve(folder, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, body);
    };
    for (const [path, body] of readTar(bytes)) if (!path.endsWith('/')) write(full, path, body);
    // Use the actual production server inventory, rather than a test-only
    // list of allowed assets. Both outputs derive from the same real pin.
    const opened = openShardfile(bytes);
    for (const row of serverRows(opened)) write(slice, row.path, opened.read(row.path));
    const sha = 'a'.repeat(40), env = {WILDSHARD_RING: '1', WS_TEST_PRODUCTS_SHA: sha, GITHUB_SHA: sha};
    const directory = readBuiltShardfile(root, slug, {env});
    expect(directory).toBe(slice);
    const product = await loadHeadlessFolder(directory);
    resident = await createNativeHeadlessResident({product, shard: product.shardfile, assets: runtimeAssets(product, directory),
      rapier: await loadRapier(readFileSync('public/assets/physics/rapier.wasm'))});
    const player = leadPlayer(resident.host), start = player.position.clone();
    for (let tick = 0; tick < 60; tick++) resident.step([{kind: 'player', moveX: 0, moveZ: -1, yaw: 0}]);
    expect(player.position.distanceTo(start)).toBeGreaterThan(.25);
    resident.dispose(); resident = undefined;
    rmSync(slice, {recursive: true});
    expect(() => readBuiltShardfile(root, slug, {env})).toThrow('Missing Ring 1 server slice driftwood-isle');
    // Ordinary full-suite readers keep their full product; Ring 1 cannot
    // silently borrow it after the sliced input disappears.
    expect(readBuiltShardfile(root, slug, {env: {}})).toBe(full);
  } finally {resident?.dispose(); rmSync(root, {recursive: true, force: true});}
}, 10_000);
