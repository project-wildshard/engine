import { expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { emptyShardfile } from '../src/shared/host/author';
import { ClientAssets } from '../src/client/game/shardfile/clientAssets';
import { prepareClientTile } from '../src/client/game/shardfile/tileContent';

test.each([false, true])('tile transport overlaps bounded reads and drains refusal before construction (%s)', async fail => {
  const scope = new Scope('tile-file-reads'), names = Array.from({ length: 6 }, (_, i) => (i + 1).toString(16).padStart(64, '0'));
  const first = names[0]; if (first === undefined) throw new Error('Missing primary fixture file');
  const source = emptyShardfile({ slug: 'tile-file-reads', name: 'Reads', author: 'Fixture', seed: 1, revision: 1 });
  source.props = { version: 1, family: 'pbr', tiles: [{ lod: 0, x: 0, z: 0, file: first, additionalFiles: names.slice(1) }],
    wholeLibrary: [], models: [], panels: [], far: null, colliders: [], textures: [] };
  const assets = new ClientAssets(source, new Map(), { base: 'https://example.invalid/', offline: true, firstParty: true,
    hash: () => Promise.reject(new Error('No verification expected from controlled read port')),
    fetch: () => Promise.reject(new Error('Unexpected network')) });
  const started: string[] = [], pending = new Map<string, { resolve: (bytes: Uint8Array) => void; reject: (error: Error) => void }>();
  const reader = vi.spyOn(assets, 'read').mockImplementation(name => {
    started.push(name); return new Promise((resolve, reject) => { pending.set(name, { resolve, reject }); });
  });
  const built: string[] = [], bytes = new Uint8Array([1]);
  const views: Parameters<typeof prepareClientTile>[4] = {
    terrain: () => { throw new Error('No fixture terrain'); },
    props: (_props, key, primary, _scope, additional) => {
      built.push(key); expect(primary).toBe(bytes); expect([...(additional?.keys() ?? [])]).toEqual(names.slice(1));
      return Promise.resolve({ mask: () => undefined, shadow: () => undefined });
    },
  };
  let settled = false;
  const loading = (async (): Promise<unknown> => {
    try { return await prepareClientTile(source, assets, '0/0/0', scope, views); }
    catch (error) { return error; }
    finally { settled = true; }
  })();
  try {
    expect(started).toEqual(names.slice(0, 4)); expect(built).toEqual([]);
    for (const name of names.slice(0, 3)) {
      const read = pending.get(name); if (read === undefined) throw new Error('Missing tile read');
      if (fail && name === first) read.reject(new Error('Verified tile refused')); else read.resolve(bytes);
    }
    await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false); expect(started).toHaveLength(4);
    const last = pending.get(names[3] ?? ''); if (last === undefined) throw new Error('Missing final batch read'); last.resolve(bytes);
    if (fail) { expect(String(await loading)).toContain('Verified tile refused'); expect(started).toHaveLength(4); expect(built).toEqual([]); }
    else {
      await vi.waitFor(() => { expect(started).toEqual(names); });
      for (const name of names.slice(4)) { const read = pending.get(name); if (read === undefined) throw new Error('Missing suffix read'); read.resolve(bytes); }
      expect(await loading).toHaveLength(1); expect(built).toEqual(['0/0/0']);
    }
  } finally { reader.mockRestore(); scope.dispose(); }
});
