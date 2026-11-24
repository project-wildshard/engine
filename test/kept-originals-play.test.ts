// FORMAT-PRUNE FP21 (SHARD-COMPAT CP16): every kept original that ships `server/native-assembly.json` admits as the cook
// admits it (`admitPin`: the original, else the format chain's validated copy), boots as a room does (`openCellWorld`: its
// native world, owned goods and keepsakes) and plays 600 server ticks. It reads each original's tarball from the pin cache (`~/.cache/wildshard/pins/<hash>.tar`, filled by `pins.ts` or
// the API) and skips when the cache lacks one, so CI without the corpus stays green; a lane proving FP21 runs it with the
// cache full. `WS_KEPT_PLAY_OUT=<file>` writes each original's digests, to compare one engine against another.
// oxlint-disable-next-line import/no-nodejs-modules -- The proof reads the kept originals' tarballs and writes their products.
import { createHash } from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { homedir } from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- As above.
import { dirname, join, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { prepareAssetDecoders } from '@wildshard/format/shardfileAssets';
import { validateShardfileFolder } from '@wildshard/format/shardfileValidation';
import { readTar } from '@wildshard/format/tar';
import { admitPin } from '../scripts/pin-admit.ts';
import { restorePacks, type PackedIndex } from '../scripts/pin-packs.ts';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { openCellWorld } from '../src/server/host/standalone/cellWorld';
import { SaveStore } from '../src/shared/engine/saves/store';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { serverInputFiles } from '../src/shared/game/shardfile/serverSkinRigs';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { snapshotSimHost } from '../src/shared/engine/sim/snapshot';
import { canonicalSimDigest } from '../src/test/engine/simState';

interface Kept { readonly hash: string; readonly revisions: readonly string[] }
const kept = (JSON.parse(readFileSync('test/fixtures/kept-native-plans.json', 'utf8')) as { originals: readonly Kept[] }).originals;
const CACHE = join(homedir(), '.cache/wildshard/pins');
const tarOf = (hash: string): string => join(CACHE, `${hash}.tar`);
const cached = kept.every(row => existsSync(tarOf(row.hash)));
const TICKS = 600;
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** The original as the cook admits it, written as a product folder (as `pins.ts install` writes `out/<folder>`). */
function admitted(hash: string, folder: string): readonly string[] {
  const files = readTar(readFileSync(tarOf(hash)));
  const { files: admittedFiles, applied } = admitPin(files, sha256, rows => validateShardfileFolder(
    { read: (path, maximum) => { const body = rows.get(path); if (body === undefined) throw new Error(`no ${path}`); if (body.length > maximum) throw new Error(`${path} is over its cap`); return body; }, paths: () => rows.keys() },
    { hash: sha256, judged: 'stored' },
  ));
  rmSync(folder, { recursive: true, force: true });
  const index = JSON.parse(new TextDecoder().decode(admittedFiles.get('shard.json'))) as PackedIndex;
  const write = (path: string, body: Uint8Array): void => { mkdirSync(dirname(join(folder, path)), { recursive: true }); writeFileSync(join(folder, path), body); };
  for (const [path, body] of admittedFiles) if (!path.endsWith('/') && path !== 'validation.json') write(path, body);
  for (const [path, body] of restorePacks(index, admittedFiles)) write(path, body);
  return applied;
}

test.skipIf(!cached)('every kept original with a native plan file admits and plays as stored (FP21, CP16)', async () => {
  expect(kept).toHaveLength(20);
  await prepareAssetDecoders();
  const rapier = await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const root = resolve('tmp/kept-originals-play'), results: Record<string, { readonly applied: readonly string[]; readonly entities: number; readonly digests: readonly string[] } | { readonly refused: string }> = {};
  try {
    for (const original of kept) {
      const label = original.revisions.join(', '), folder = join(root, original.hash.slice(0, 12));
      try {
        const applied = admitted(original.hash, folder);
        const product = await loadHeadlessFolder(folder), shard = product.shardfile, descriptor = outputDescriptor(shard);
        if (descriptor === undefined) throw new Error('no admitted output');
        const assets = new Map(serverInputFiles(descriptor.index.files, shard)
          .map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(join(folder, file.path)))]));
        // a room's boot (codex-ms's production preflight): the cell world with every solid, its owned goods and keepsakes
        const live = await openCellWorld({ instance: shard.identity.slug }, { shard, assets, rapier, product }, undefined,
          { saves: new SaveStore({ local: null, session: null }), lone: false, wholeSolids: true });
        try {
          const digests: string[] = [];
          for (let tick = 0; tick < TICKS; tick++) { live.step([]); if (tick % 60 === 59) digests.push(canonicalSimDigest(snapshotSimHost(live.host))); }
          results[label] = { applied, entities: live.host.entities.size, digests };
        } finally { live.dispose(); }
      } catch (error) {
        results[label] = { refused: error instanceof Error ? error.message.split('\n')[0] ?? '' : String(error) };
      } finally { rmSync(folder, { recursive: true, force: true }); }
    }
  } finally {
    const out = process.env['WS_KEPT_PLAY_OUT'];
    if (out !== undefined) writeFileSync(out, `${JSON.stringify(results, null, 1)}\n`);
  }
  const refused = Object.entries(results).flatMap(([label, row]) => 'refused' in row ? [label] : []);
  expect(refused, JSON.stringify(Object.fromEntries(Object.entries(results).filter(([, row]) => 'refused' in row)))).toEqual([]);
  for (const [label, row] of Object.entries(results)) if (!('refused' in row)) expect(row.digests, label).toHaveLength(TICKS / 60);
}, 1_800_000);
