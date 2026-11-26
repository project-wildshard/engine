// oxlint-disable-next-line import/no-nodejs-modules -- The worker's reader runs on a built product's bytes.
import { existsSync, readFileSync } from 'node:fs';
import { afterEach, expect, test } from 'vitest';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { NearColliders } from '../src/shared/engine/physics/nearColliders';
import { answerHeldReads, askHeldReads, type HeldRead } from '../src/shared/host/standalone/heldReads';
import { fetchServerFolder } from '../src/server/host/standalone/serverFolder';
import { createNativeHeadlessResident } from '../src/server/host/headlessRuntime';
import { folderClosureFile } from '../src/shared/game/shardfile/shardFolder';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { builtFolder } from '../src/test/game/builtFolder';

// QA 11-25 row 68r: each held read waits for the page's main thread. Nalati's world create on a 4-core Linux runner asked the
// page 63 times, and waited 22.7 s of its 28.9 s for "not mine" while the page drew its software-GL first frame.

const page = { location: Reflect.get(globalThis, 'location'), fetch: globalThis.fetch };
afterEach(() => { Reflect.set(globalThis, 'location', page.location); Reflect.set(globalThis, 'fetch', page.fetch); });

/** A worker's network over a built product folder, counting each path it reads. */
function network(directory: string, root: string): Map<string, number> {
  const reads = new Map<string, number>();
  Reflect.set(globalThis, 'location', { href: 'https://held.test/b/test/standalone/serverWorker.js' });
  Reflect.set(globalThis, 'fetch', (input: URL | string) => {
    const href = input instanceof URL ? input.href : input, path = href.startsWith(root) ? href.slice(root.length) : null;
    if (path === null || !existsSync(`${directory}/${path}`)) return Promise.resolve(new Response(null, { status: 404 }));
    reads.set(path, (reads.get(path) ?? 0) + 1);
    return Promise.resolve(new Response(readFileSync(`${directory}/${path}`)));
  });
  return reads;
}

test('one ask names the files the page lists; a page with no check lists them all', async () => {
  const listing = new MessageChannel(), plain = new MessageChannel();
  answerHeldReads(listing.port1, () => Promise.resolve(null), url => url.endsWith('/held'));
  answerHeldReads(plain.port1, () => Promise.resolve(null));
  try {
    expect(await askHeldReads(listing.port2).listed?.(['a/held', 'a/other'])).toEqual([true, false]);
    expect(await askHeldReads(plain.port2).listed?.(['a', 'b'])).toEqual([true, true]);
  } finally { for (const channel of [listing, plain]) { channel.port1.close(); channel.port2.close(); } }
});

test('Nalati\'s world create never waits on the page for a file it doesn\'t list', async () => {
  const directory = builtFolder('nalati-grasslands'), root = 'https://held.test/shardfiles/nalati-grasslands/', reads = network(directory, root);
  const asked: string[] = [], listings: (readonly string[])[] = [];
  const held: HeldRead = Object.assign((url: string) => { asked.push(url); return Promise.resolve(null); },
    { listed: (urls: readonly string[]) => { listings.push(urls); return Promise.resolve(urls.map(() => false)); } });
  const input = await fetchServerFolder(root, await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), held, undefined, true);
  const before = asked.length;
  const resident = await createNativeHeadlessResident(input, undefined, { room: true, grid: true, near: new NearColliders() });
  try {
    expect(listings).toHaveLength(1);
    // only the header and its sections ask, all at once, before the descriptor names the server's files
    expect(asked.filter(url => url !== `${root}shard.json` && !url.startsWith(`${root}sections/`))).toEqual([]);
    expect(asked.slice(before)).toEqual([]);
    // the one listing names every file the create read from the network
    const listed = new Set(listings[0]);
    expect([...reads.keys()].filter(path => path !== 'shard.json' && !path.startsWith('sections/') && !path.startsWith('server/') && !listed.has(`${root}${path}`))).toEqual([]);
  } finally { resident.dispose(); }
});

test('a file asked for again while its read runs is read once', async () => {
  const directory = builtFolder('nalati-grasslands'), root = 'https://held.test/shardfiles/nalati-grasslands/', reads = network(directory, root);
  const { product } = await fetchServerFolder(root, await loadRapier(readFileSync('public/assets/physics/rapier.wasm')), undefined, undefined, true);
  if (product === undefined) throw new Error('The worker read no product');
  const file = outputDescriptor(product.shardfile)?.index.files.find(row => row.name === 'actors/sheep.json');
  if (file === undefined) throw new Error('Nalati names no sheep book');
  const [first, second] = await Promise.all([folderClosureFile(product, file.hash), folderClosureFile(product, file.hash)]);
  expect(reads.get(file.path)).toBe(1);
  expect(first).toEqual(second);
  first[0] = (first[0] ?? 0) ^ 0xff;
  expect(second[0]).not.toBe(first[0]); // each ask has its own copy
});
