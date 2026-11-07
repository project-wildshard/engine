import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { SharedTileBuilds } from './tileContent';
import { realGc } from '@wildshard/engine/test/realGc';

async function retiredBuild(holder: Scope): Promise<{ builds: SharedTileBuilds<object>; ref: WeakRef<object> }> {
  const owner = new Scope('retired resident');
  const builds = new SharedTileBuilds(owner, () => Promise.resolve({ bytes: new Uint8Array(16) }));
  const value = await builds.hold(5, holder), ref = new WeakRef(value);
  owner.dispose();
  expect([...builds.tiles]).toEqual([]);
  return { builds, ref };
}

test('a live ring holder releases the payload of a retired resident build', async () => {
  await realGc('src/client/game/shardfile/tile-build-lifetime.test.ts', 'a live ring holder releases the payload of a retired resident build', async collect => {
    const holder = new Scope('independent ring');
    try {
      const { builds, ref } = await retiredBuild(holder);
      await collect(ref);
      expect(holder.disposed).toBe(false);
      expect(holder.census.disposers).toBe(0);
      expect([...builds.tiles]).toEqual([]);
    } finally { holder.dispose(); }
  });
});

test('a failed tile build removes its hold from the still live ring', async () => {
  const owner = new Scope('live resident'), holder = new Scope('live ring');
  const builds = new SharedTileBuilds<number>(owner, () => Promise.reject(new Error('refused tile')));
  try {
    const before = holder.census.disposers;
    await expect(builds.hold(5, holder)).rejects.toThrow('refused tile');
    expect([...builds.tiles]).toEqual([]);
    expect(holder.census.disposers).toBe(before);
  } finally { holder.dispose(); owner.dispose(); }
});

async function retiredHolder(builds: SharedTileBuilds<number>): Promise<WeakRef<Scope>> {
  const holder = new Scope('departed render ring');
  await builds.hold(5, holder);
  holder.dispose();
  return new WeakRef(holder);
}

test('a shared live build releases a departed holder while another ring still holds it', async () => {
  await realGc('src/client/game/shardfile/tile-build-lifetime.test.ts', 'a shared live build releases a departed holder while another ring still holds it', async collect => {
    const owner = new Scope('live resident'), holder = new Scope('collider ring');
    const builds = new SharedTileBuilds(owner, () => Promise.resolve(50));
    try {
      expect(await builds.hold(5, holder)).toBe(50);
      await collect(await retiredHolder(builds));
      expect([...builds.tiles]).toEqual([5]);
      expect(await builds.hold(5, holder)).toBe(50);
    } finally { holder.dispose(); owner.dispose(); }
  });
});
