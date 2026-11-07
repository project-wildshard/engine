import { installCatalogueFixture } from './fixtures/bootSetup';
import { installShards, shards } from '../src/client/game/shard/list';
import { game, setActiveChunk } from '../src/client/game/shard/registry';
import { expect, test, vi } from 'vitest';
import { emptyShardfile } from '../src/shared/host/author';
import { encodeCanonicalJson, hashImmutableBytes } from '../src/shared/host/immutable';
import { outputSectionPayloads } from '@wildshard/format/outputFields';
import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { installManifestShardfile, shardfileSource } from '../src/client/game/shardfile/clientSource';
import type { ShardfileClientBindings } from '../src/client/game/shardfile/client';
import type { ProductOptions } from '../src/client/game/shardfile/product';
import { NO_AUDIO } from '../src/client/engine/audio/levelAudio';

await installCatalogueFixture();

const bindings: ShardfileClientBindings = { instance: 'audio-owner', recipes: new Map(), items: new Map(),
  voices: () => new Map(), catalogue: [], icon: () => { throw new Error('No fixture items'); } };

function fixture(scene: boolean): { options: ProductOptions; index: ReturnType<typeof parseOutputIndex> } {
  const source = emptyShardfile({ slug: 'open-plot-lantern-bayou', name: 'Audio owner', author: 'Test', seed: 1, revision: 1 });
  const wires = new Map<string, Uint8Array>();
  const encode = (value: unknown): Uint8Array => new TextEncoder().encode(encodeCanonicalJson(value));
  const payloads = new Map(outputSectionPayloads(source));
  if (scene) payloads.set('client/plan', { version: 1, features: [{ kind: 'audio.scene' }] });
  const sections = [...payloads].map(([name, payload]) => {
    const bytes = encode(payload), path = `sections/${name}.json`; wires.set(path, bytes);
    return { name, path, schema: `wildshard:${name}@1`, hash: hashImmutableBytes(bytes), bytes: bytes.length };
  });
  const index = parseOutputIndex({ format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version,
    identity: source.identity, build: { sourceHash: hashImmutableBytes(encode(source)), validator: 'test' }, requires: source.requires,
    admission: { budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library },
    sections, schemas: [], files: [], runtime: null });
  wires.set('shard.json', encode(index));
  return { index, options: { base: 'https://example.test/', offline: false, firstParty: true,
    fetch: url => {
      const bytes = wires.get(url.slice('https://example.test/'.length));
      return Promise.resolve(bytes === undefined ? new Response(null, { status: 404 }) : new Response(Uint8Array.from(bytes)));
    }, hash: bytes => Promise.resolve(hashImmutableBytes(bytes)) } };
}

test.each([false, true])('first-party audio catalogue survives only explicit scene ownership: %s', async scene => {
  const previous = shards(), active = game.shard;
  try {
  const f = fixture(scene), manifest = await shardfileSource(f.index, f.options, bindings);
  if (manifest.boot === undefined) throw new Error('Missing compiled boot inventory');
  const preload = vi.fn(() => Promise.resolve(NO_AUDIO)), inventory = vi.fn(() => Promise.resolve(['/assets/scene-loop.m4a']));
  const installed = await installManifestShardfile({ ...manifest, shardfile: '/shard.json',
    audio: { ambience: 'none', score: 'none', preload }, boot: { ...manifest.boot, audio: inventory } }, f.options, bindings);
  if (scene) {
    expect(installed.audio?.preload).toBe(preload); expect(installed.boot?.audio).toBe(inventory);
    expect(await installed.audio?.preload?.()).toBe(NO_AUDIO);
    const files = installed.boot?.audio;
    if (typeof files !== 'function') throw new Error('Missing retained counted audio inventory');
    expect(await files()).toEqual(['/assets/scene-loop.m4a']);
  } else {
    expect(installed.audio?.preload).toBeUndefined(); expect(installed.boot?.audio).not.toBe(inventory);
    expect(preload).not.toHaveBeenCalled(); expect(inventory).not.toHaveBeenCalled();
  }
  } finally { installShards(previous); setActiveChunk(active.slug); }
});
