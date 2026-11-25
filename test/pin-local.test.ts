/* oxlint-disable import/no-nodejs-modules -- Drive the real pin CLI with admitted product bytes. */
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync} from 'node:fs';
import {dirname, join, resolve as resolvePath} from 'node:path';
import {afterEach, expect, test} from 'vitest';
import {readTar} from '@wildshard/format/tar';
import {validationSourceBytes} from '@wildshard/format/validationReceipt';
import {wholeBrasscapProduct} from '../scripts/pin-format.ts';
import {cookPreparationBytes} from '@wildshard/format/cookPreparation';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {localCandidates, LOCAL_CANDIDATES} from '../scripts/local-candidates.ts';
import {cookShard, openShardfile} from '../src/cook/game/shardCook.ts';
import {folderTarball} from '../src/cook/game/folderTarball';
import {loadCookedFolder} from '../src/server/host/headlessFolder';
import {openWorld} from '../src/server/host/openWorld';
import {loadRapier} from '../src/shared/engine/physics/rapier';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true}); });
function addLocalMount(source: string): void {
  const digest = (body: Uint8Array): string => createHash('sha256').update(body).digest('hex');
  const url = '/assets/local-proof/shared.json', bytes = Buffer.from('{}'), path = `mounts${url}`;
  mkdirSync(dirname(join(source, path)), {recursive: true}); writeFileSync(join(source, path), bytes);
  const cook = JSON.parse(readFileSync(join(source, 'cook.json'), 'utf8')) as {mounts: {url: string; path: string; hash: string; bytes: number}[]; inputHash?: string; renderer?: string};
  cook.mounts.push({url, path, hash: digest(bytes), bytes: bytes.length});
  // A prepared product (the live pin, QA 11-24 row 70) binds its mounts in the preparation's input hash.
  if (cook.inputHash !== undefined) cook.inputHash = digest(cookPreparationBytes(parseOutputIndex(JSON.parse(readFileSync(join(source, 'shard.json'), 'utf8'))), cook.mounts, cook.renderer));
  const cookBytes = validationSourceBytes(cook); writeFileSync(join(source, 'cook.json'), cookBytes);
  const index = JSON.parse(readFileSync(join(source, 'shard.json'), 'utf8')) as {cook: {bytes: number; hash: string}};
  index.cook.bytes = cookBytes.length; index.cook.hash = digest(cookBytes);
  const indexBytes = validationSourceBytes(index); writeFileSync(join(source, 'shard.json'), indexBytes);
  const receipt = JSON.parse(readFileSync(join(source, 'validation.json'), 'utf8')) as {indexHash: string};
  receipt.indexHash = digest(indexBytes); writeFileSync(join(source, 'validation.json'), JSON.stringify(receipt));
}
function fixture() {
  mkdirSync('tmp/codex-pins-ll4-tests', {recursive: true});
  const root = mkdtempSync(resolvePath('tmp/codex-pins-ll4-tests/product-')); roots.push(root);
  const product = wholeBrasscapProduct(), source = join(root, 'producer/out/brasscap-mesa');
  for (const [path, bytes] of readTar(product.bytes)) {
    mkdirSync(dirname(join(source, path)), {recursive: true}); writeFileSync(join(source, path), bytes);
  }
  addLocalMount(source);
  mkdirSync(join(root, 'test/pins'), {recursive: true});
  writeFileSync(join(root, 'test/pins/shardfiles.json'), JSON.stringify({api: 'local', shards: [product.pin]}));
  writeFileSync(join(root, 'test/pins/assets.json'), JSON.stringify({version: 1, assets: []}));
  return {root, source, product};
}
function cli(root: string, args: readonly string[], env: NodeJS.ProcessEnv = {}) {
  return new Promise<{status: number | null; output: string}>(resolve => {
    const child = spawn(process.execPath, [resolvePath('scripts/pins.ts'), ...args], {cwd: root,
      env: {...process.env, CI: '', WILDSHARD_PINS_REUSE: '0', ...env}});
    let output = '';
    child.stdout.on('data', (part: Buffer) => { output += part.toString(); });
    child.stderr.on('data', (part: Buffer) => { output += part.toString(); });
    child.on('close', status => { resolve({status, output}); });
  });
}

test('actual local admission, runtime open and published restoration leave the tracked pin unchanged', async () => {
  const {root, source, product} = fixture(), pins = readFileSync(join(root, 'test/pins/shardfiles.json'));
  const admitted = await cli(root, ['install', '--from-dir', source]);
  expect(admitted.output).toContain('1 of 1 pins admitted'); expect(admitted.status).toBe(0);
  const rows = localCandidates(root, {CI: ''});
  expect(rows).toMatchObject([{slug: 'brasscap-mesa', path: source, indexHash: createHash('sha256').update(readFileSync(join(source, 'shard.json'))).digest('hex')}]);
  const installed = folderTarball(join(root, 'out/brasscap-mesa'));
  expect(openShardfile(installed).slug).toBe('brasscap-mesa');
  expect(createHash('sha256').update(installed).digest('hex')).not.toBe(product.pin.hash);
  const cooked = await cookShard(installed, join(root, 'cooked'), {wireBytes: (_url, body) => body.length, now: () => performance.now()});
  expect(cooked.manifests.length).toBeGreaterThan(0);
  expect(existsSync(join(root, 'cooked', cooked.server.index))).toBe(true);
  const rapier = await loadRapier(readFileSync(createRequire(import.meta.url).resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm')));
  const input = await loadCookedFolder(join(root, 'out/brasscap-mesa'), rapier);
  const world = await openWorld(input, {room: true});
  try {
    expect(world.host.players.size).toBeGreaterThan(0);
    const player = world.host.players.values().next().value;
    expect(player).toBeDefined();
    if (player === undefined) throw new Error('World did not spawn a player');
    expect(Number.isFinite(player.position.x)).toBe(true);
    const before = world.host.state.tick;
    world.step([]);
    expect(world.host.state.tick).toBeGreaterThan(before);
  } finally { world.dispose(); }
  expect(JSON.parse(readFileSync(join(root, 'out/brasscap-mesa/validation.json'), 'utf8'))).toMatchObject({source: {kind: 'local-directory', path: source}});
  const server = createServer((request, response) => {
    if (request.url === `/${product.pin.hash}.tar`) response.end(product.bytes);
    else { response.statusCode = 404; response.end(); }
  });
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve); });
  try {
    const address = server.address(); if (address === null || typeof address === 'string') throw new Error('No port');
    const restored = await cli(root, ['install'], {WILDSHARD_PIN_MIRROR: `http://127.0.0.1:${address.port}`, WILDSHARD_PIN_CACHE: join(root, 'cache')});
    expect(restored.output).toContain('1 of 1 pins admitted'); expect(restored.status).toBe(0);
    expect(existsSync(join(root, LOCAL_CANDIDATES))).toBe(false);
    expect(existsSync(join(root, 'public/assets/local-proof/shared.json'))).toBe(false);
    expect(readFileSync(join(root, 'test/pins/shardfiles.json'))).toEqual(pins);
    expect(JSON.parse(readFileSync(join(root, 'out/brasscap-mesa/validation.json'), 'utf8'))).not.toHaveProperty('source');
  } finally { server.closeAllConnections(); server.close(); }
});

test('malformed input and symlinks refuse before replacing an installed product', async () => {
  const {root, source} = fixture();
  expect((await cli(root, ['install', '--from-dir', source])).status).toBe(0);
  const prior = readFileSync(join(root, 'out/brasscap-mesa/shard.json'));
  writeFileSync(join(source, 'validation.json'), JSON.stringify({indexHash: '0'.repeat(64)}));
  expect((await cli(root, ['install', '--from-dir', source])).status).not.toBe(0);
  expect(readFileSync(join(root, 'out/brasscap-mesa/shard.json'))).toEqual(prior);
  symlinkSync(join(source, 'shard.json'), join(source, 'aliased.json'));
  const linked = await cli(root, ['install', '--from-dir', source]);
  expect(linked.status).not.toBe(0);
  expect(linked.output).toContain('non-regular');
});

test('a mount owned by another shard refuses without changing that owner', async () => {
  const {root, source} = fixture(), url = '/assets/local-proof/shared.json';
  const target = join(root, 'public', url);
  mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, 'other shard bytes');
  mkdirSync(join(root, 'out/other'), {recursive: true});
  writeFileSync(join(root, 'out/other/shard.json'), '{}');
  writeFileSync(join(root, 'out/other/cook.json'), JSON.stringify({mounts: [{url, path: 'other'}]}));
  const refused = await cli(root, ['install', '--from-dir', source]);
  expect(refused.output).toContain('conflicts with another owner'); expect(refused.status).not.toBe(0);
  expect(readFileSync(target, 'utf8')).toBe('other shard bytes');
  expect(existsSync(join(root, LOCAL_CANDIDATES))).toBe(false);
});

test('CI refuses explicit local admission and ignores even malformed local provenance', async () => {
  const {root, source} = fixture();
  mkdirSync(join(root, 'out'), {recursive: true}); writeFileSync(join(root, LOCAL_CANDIDATES), 'not json');
  expect(localCandidates(root, {CI: 'true'})).toEqual([]);
  const refused = await cli(root, ['install', '--from-dir', source], {CI: 'true'});
  expect(refused.output).toContain('CI installs published pins'); expect(refused.status).not.toBe(0);
});

test('an unowned existing mount remains untouched even when its bytes match', async () => {
  const {root, source} = fixture(), target = join(root, 'public/assets/local-proof/shared.json');
  mkdirSync(dirname(target), {recursive: true}); writeFileSync(target, '{}');
  const refused = await cli(root, ['install', '--from-dir', source]);
  expect(refused.status).not.toBe(0);
  expect(refused.output).toContain('unowned existing mount');
  expect(readFileSync(target, 'utf8')).toBe('{}');
  expect(existsSync(join(root, LOCAL_CANDIDATES))).toBe(false);
});
