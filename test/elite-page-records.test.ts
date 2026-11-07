// Lanes a page has and a world doesn't: their records outlive the world's saves.
// oxlint-disable-next-line import/no-nodejs-modules -- Rapier is a shipped binary.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { serializeSimSnapshot, snapshotSimHostBytes } from '../src/shared/engine/sim/snapshot';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { loadHeadlessProduct } from '../src/server/host/headlessProduct';
import { createTrustedHeadlessResident, type PageProgress } from '../src/server/host/headlessRuntime';
import { builtProduct } from './fixtures/builtProduct';

async function nalati(page?: PageProgress, snapshot?: string) {
  const directory = builtProduct('nalati-grasslands'), product = await loadHeadlessProduct(directory), descriptor = outputDescriptor(product.shardfile);
  if (descriptor === undefined) throw new Error('Missing output');
  const assets = new Map(descriptor.index.files.map(file => [file.commons === true ? `commons:${file.hash}` : file.hash, Uint8Array.from(readFileSync(`${directory}/${file.path}`))]));
  return createTrustedHeadlessResident({ product, shard: product.shardfile, assets, rapier: await loadRapier(Uint8Array.from(readFileSync('public/assets/physics/rapier.wasm'))) }, snapshot, { room: true, ...page === undefined ? {} : { page } });
}
const adapter = (host: Awaited<ReturnType<typeof nalati>>['host'], id: string): { records: Record<string, unknown> } => { const value = host.adapters.get(id)?.snapshot(); return (typeof value === 'string' ? JSON.parse(value) : value) as { records: Record<string, unknown> }; };
const row = (kills: number, skinTaken = true) => ({ timer: 600, discovered: true, skinTaken, kills, retired: false });

test('a world keeps the records of lairs it has no row for', { timeout: 90_000 }, async () => {
  const page = { aqbars: row(1), kokbori: row(0, false), argymaq: row(0, false), qyran: row(3), 'qara-batyr': row(2) };
  const live = await nalati({ flags: [], state: new Map([['nalati.elites', JSON.stringify(page)]]) });
  const wire = serializeSimSnapshot(snapshotSimHostBytes(live.host)), first = adapter(live.host, 'nalati.elites');
  expect(Object.keys(first.records).sort()).toEqual(Object.keys(page).sort());
  live.dispose();
  const back = await nalati(undefined, wire);
  try { const records = adapter(back.host, 'nalati.elites').records; expect(records).toMatchObject({ qyran: row(3), 'qara-batyr': row(2) }); } finally { back.dispose(); }
});

test('an old row save, three records and no captain, still loads, and he rides on it unspawned', { timeout: 90_000 }, async () => {
  const live = await nalati(), captain = 'nalati.patrol.captain';
  expect(live.host.adapters.has(captain)).toBe(true);
  const saved = snapshotSimHostBytes(live.host), three = (state: typeof saved.adapters[number]['state']) => { const held = (typeof state === 'string' ? JSON.parse(state) : state) as { records: Record<string, unknown> }, kept = { ...held, records: Object.fromEntries(Object.entries(held.records).filter(([id]) => ['aqbars', 'kokbori', 'argymaq'].includes(id))) }; return typeof state === 'string' ? JSON.stringify(kept) : kept as typeof state; };
  const adapters = saved.adapters.filter(entry => entry.id !== captain), at = adapters.findIndex(entry => entry.id === 'nalati.elites'), held = adapters[at];
  if (held === undefined) throw new Error('No elites');
  adapters[at] = { ...held, state: three(held.state) };
  const old = { ...saved, adapters };
  live.dispose();
  const back = await nalati(undefined, serializeSimSnapshot(old));
  try { expect(Object.keys(adapter(back.host, 'nalati.elites').records).sort()).toEqual(['aqbars', 'argymaq', 'kokbori', 'qara-batyr', 'qyran']); expect(back.host.adapters.has(captain)).toBe(true); } finally { back.dispose(); }
});
