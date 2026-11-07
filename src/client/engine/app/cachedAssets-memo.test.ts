import { expect, test } from 'vitest';
import { BoxGeometry, MeshStandardMaterial, Texture } from 'three';
import { ResourceMemo, rebindGeometry } from './cachedAssets';

test('shares immediate async acquisition and forgets both source and dependent surface on retirement', async () => {
  const mats = new ResourceMemo<string, MeshStandardMaterial>();
  const retired: string[] = [];
  const sources = new ResourceMemo<string, { geometry: BoxGeometry; map: Texture }>(key => {
    retired.push(key); mats.invalidate(key);
  });
  const source = { geometry: new BoxGeometry(), map: new Texture() };
  let loads = 0;
  const load = (): Promise<typeof source> => { loads++; return Promise.resolve(source); };
  try {
    const first = sources.load('person', load);
    expect(loads).toBe(1); expect(sources.peek('person')).toBeUndefined();
    expect(sources.load('person', load)).toBe(first);
    expect(await first).toBe(source); expect(sources.load('person', load)).toBe(first);
    const mat = mats.acquire('person', () => new MeshStandardMaterial({ map: source.map }));
    expect(mats.acquire('person', () => { throw new Error('must not recreate'); })).toBe(mat);
    expect([...sources.entries()]).toEqual([['person', source]]);
    rebindGeometry(source.geometry); expect(sources.peek('person')).toBe(source);
    source.geometry.dispose();
    expect(sources.peek('person')).toBeUndefined(); expect(mats.peek('person')).toBeUndefined();
    expect(retired).toEqual(['person']);
    // Forgetting never disposes a borrowed material or texture.
    let disposed = 0; source.map.addEventListener('dispose', () => { disposed++; });
    mats.invalidate('person'); expect(disposed).toBe(0);
    expect(await sources.load('person', load)).toBe(source); expect(loads).toBe(2);
    mat.dispose();
  } finally { source.geometry.dispose(); source.map.dispose(); }
});

test('failed factories retry and late invalidated promises cannot replace a current resource', async () => {
  const memo = new ResourceMemo<string, Texture>();
  const error = new Error('admission failed'), old = new Texture(), fresh = new Texture();
  try {
    await expect(memo.load('asset', () => Promise.reject(error))).rejects.toBe(error);
    expect(memo.peek('asset')).toBeUndefined();
    await expect(memo.load('asset', () => { throw error; })).rejects.toBe(error);
    expect(() => memo.acquire('asset', () => { throw error; })).toThrow(error);
    let finish: (value: Texture) => void = () => { throw new Error('missing deferred load'); };
    const stale = memo.load('asset', () => new Promise(resolve => { finish = resolve; }));
    memo.invalidate('asset');
    const current = memo.load('asset', () => Promise.resolve(fresh));
    expect(await current).toBe(fresh);
    finish(old); expect(await stale).toBe(old); expect(memo.peek('asset')).toBe(fresh);
    old.dispose(); expect(memo.peek('asset')).toBe(fresh);
    fresh.dispose(); expect(memo.peek('asset')).toBeUndefined();
    const sync = memo.acquire('asset', () => old);
    expect(await memo.load('asset', () => { throw error; })).toBe(sync);
  } finally { old.dispose(); fresh.dispose(); }
});
