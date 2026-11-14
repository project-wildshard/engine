// A world's first boot takes the fights a page's save held: a beaten boss, a running count, an elite's timer (the flip).
// oxlint-disable-next-line import/no-nodejs-modules -- A world runs the shipped product bytes and physics module.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { memoryElitePersistence } from '../src/shared/game/eliteSystem';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { createTrustedHeadlessResident, type PageProgress } from '../src/server/host/headlessRuntime';
import { builtFolder } from './fixtures/builtFolder';

async function nalati(page?: PageProgress, snapshot?: string) {
  const directory = builtFolder('nalati-grasslands'), product = await loadHeadlessFolder(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, snapshot, { room: true, ...page === undefined ? {} : { page } });
}
const adapter = (host: Awaited<ReturnType<typeof nalati>>['host'], id: string): unknown => { const value = host.adapters.get(id)?.snapshot(); return typeof value === 'string' ? JSON.parse(value) : value; };

test('a page\'s beaten king, counts and elites stand in a world\'s first boot', { timeout: 90_000 }, async () => {
  const live = await nalati({ flags: ['dead:golden-king'], state: new Map([
    ['nalati.bosses', JSON.stringify({ 'golden-king': { defeated: true, rewardTaken: true, kills: 1 } })],
    ['nalati.feat-counts', JSON.stringify({ wolf5: 3 })],
    ['nalati.elites', JSON.stringify({ aqbars: { timer: 900, discovered: true, skinTaken: true, kills: 1, retired: false } })],
  ]) });
  try {
    const { host } = live;
    expect(host.flags.has('dead:golden-king')).toBe(true);
    expect(adapter(host, 'nalati.chapter-records')).toMatchObject({ bosses: { 'golden-king': { defeated: true, rewardTaken: true, kills: 1 } }, counts: { wolf5: 3 } });
    expect(adapter(host, 'nalati.king')).toMatchObject({ boss: { saved: { defeated: true, rewardTaken: true, kills: 1 } } });
    expect(adapter(host, 'nalati.elites')).toMatchObject({ records: { aqbars: { timer: 900, discovered: true, skinTaken: true, kills: 1 } } });
  } finally { live.dispose(); }
});

test('a world that took a page\'s lairs saves and restores, even one it has no row for', { timeout: 90_000 }, async () => {
  const live = await nalati({ flags: [], state: new Map([['nalati.elites', JSON.stringify({ aqbars: { timer: 900, discovered: true, skinTaken: false, kills: 1, retired: false }, gone: { timer: 0, discovered: true, skinTaken: false, kills: 2, retired: false } })]]) });
  const wire = serializeSimSnapshot(snapshotSimHostBytes(live.host)), held = adapter(live.host, 'nalati.elites');
  live.dispose();
  const back = await nalati(undefined, wire);
  try { expect(adapter(back.host, 'nalati.elites')).toMatchObject({ records: (held as { records: object }).records }); } finally { back.dispose(); }
});

test('a page field a world can\'t read starts it fresh', { timeout: 90_000 }, async () => {
  expect(memoryElitePersistence('x', { aqbars: { timer: 'soon' } }).read('x')).toEqual({});
  const live = await nalati({ flags: [], state: new Map([['nalati.bosses', 'not json'], ['nalati.feat-counts', JSON.stringify({ wolf5: 'many' })]]) });
  try { expect(adapter(live.host, 'nalati.chapter-records')).toMatchObject({ bosses: {}, counts: {} }); } finally { live.dispose(); }
});
