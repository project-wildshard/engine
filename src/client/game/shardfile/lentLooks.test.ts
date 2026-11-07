import { expect, test } from 'vitest';
import { Material } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { withOwner } from '@wildshard/engine/app/ownership';
import { lendLooks, lentLook, prepareLentLooks, setLentParam, type LentLooks } from './lentLooks';

test('preparation groups retain owner, ID order and sequential async barriers', async () => {
  const a = new Scope('looks-a'), b = new Scope('looks-b'), eager = new Scope('looks-eager'), material = new Material();
  const calls: { owner: string; ids: readonly string[] }[] = [];
  let release = (): void => { throw new Error('Missing prepare barrier'); };
  const barrier = new Promise<void>(resolve => { release = resolve; });
  const lend = (scope: Scope, ids: readonly string[], prepare?: LentLooks['prepare']): void => {
    lendLooks(scope, { materials: new Map(ids.map(id => [id, material])),
      setParam: () => undefined, setTexture: () => undefined, bindMeshMap: () => material,
      ...(prepare === undefined ? {} : { prepare }) });
  };
  lend(a, ['shared', 'a'], ids => { calls.push({ owner: 'a', ids }); return Promise.resolve(); });
  lend(b, ['shared', 'b'], async ids => { calls.push({ owner: 'b', ids }); await barrier; });
  lend(eager, ['eager']);
  try {
    const pending = withOwner(a, () => prepareLentLooks(['b', 'shared', 'a', 'b', 'missing', 'eager']));
    expect(calls).toEqual([{ owner: 'b', ids: ['b'] }]);
    release(); await pending;
    expect(calls).toEqual([{ owner: 'b', ids: ['b'] }, { owner: 'a', ids: ['shared', 'a'] }]);
    const first = calls[1]?.ids;
    await withOwner(b, () => prepareLentLooks(['a', 'shared']));
    expect(calls.slice(2)).toEqual([{ owner: 'a', ids: ['a'] }, { owner: 'b', ids: ['shared'] }]);
    expect(first).toEqual(['shared', 'a']);
    expect(calls[2]?.ids).not.toBe(first);
    a.dispose(); b.dispose();
    await prepareLentLooks(['shared', 'a', 'b', 'eager']);
    expect(calls).toHaveLength(4);
  } finally { release(); a.dispose(); b.dispose(); eager.dispose(); material.dispose(); }
});

test('a param write reaches every compile on the owner line, never another world; unowned, the newest', () => {
  const level = new Scope('level'), play = new Scope('runtime.play', level), other = new Scope('other-world'), material = new Material();
  const writes: string[] = [];
  const lend = (scope: Scope, name: string): void => {
    lendLooks(scope, { materials: new Map([['look', material]]),
      setParam: () => { writes.push(name); }, setTexture: () => undefined, bindMeshMap: () => material });
  };
  lend(level, 'level'); lend(play, 'page'); lend(other, 'other');
  try {
    withOwner(level, () => { setLentParam('look', 'fade', 1); });
    expect(writes.splice(0)).toEqual(['page', 'level']);
    withOwner(play, () => { setLentParam('look', 'fade', 1); });
    expect(writes.splice(0)).toEqual(['page', 'level']);
    withOwner(other, () => { setLentParam('look', 'fade', 1); });
    expect(writes.splice(0)).toEqual(['other']);
    setLentParam('look', 'fade', 1);
    expect(writes.splice(0)).toEqual(['other']);
    const stranger = new Scope('stranger');
    withOwner(stranger, () => { setLentParam('look', 'fade', 1); });
    expect(writes.splice(0)).toEqual(['other']);
    stranger.dispose();
  } finally { level.dispose(); other.dispose(); material.dispose(); }
});

test('warm owner books retain every write and refresh after a lend starts or retires', () => {
  const level = new Scope('writer-level'), other = new Scope('writer-other'), material = new Material();
  const writes: string[] = [];
  const lend = (scope: Scope, label: string): void => {
    lendLooks(scope, { materials: new Map([['warm', material]]),
      setParam: (_id, name, value) => { writes.push(`${label}:${name}:${JSON.stringify(value)}`); },
      setTexture: () => undefined, bindMeshMap: () => material });
  };
  lend(level, 'level'); lend(other, 'other');
  const put = (scope: Scope | null): void => { withOwner(scope, () => { setLentParam('warm', 'fade', 0); setLentParam('warm', 'fade', 0); }); };
  const page = new Scope('writer-page', level);
  try {
    put(level); put(level); put(other); put(null); put(level);
    expect(writes.splice(0)).toEqual([
      'level:fade:0', 'level:fade:0', 'level:fade:0', 'level:fade:0',
      'other:fade:0', 'other:fade:0', 'other:fade:0', 'other:fade:0', 'level:fade:0', 'level:fade:0',
    ]);
    lend(page, 'page');
    put(level);
    expect(writes.splice(0)).toEqual(['page:fade:0', 'level:fade:0', 'page:fade:0', 'level:fade:0']);
    page.dispose(); put(level);
    expect(writes.splice(0)).toEqual(['level:fade:0', 'level:fade:0']);
    level.dispose(); other.dispose(); put(null);
    expect(writes).toEqual([]);
  } finally { level.dispose(); other.dispose(); material.dispose(); }
});

test('a reentrant catalogue read cannot publish a cold book under another owner', () => {
  const level = new Scope('reentrant-level'), other = new Scope('reentrant-other'), material = new Material();
  const writes: string[] = [];
  let entered = false;
  class ReentrantMaterials extends Map<string, Material> {
    override has(id: string): boolean {
      if (id === 'outer' && !entered) {
        entered = true;
        withOwner(other, () => { setLentParam('inner', 'fade', 1); });
      }
      return super.has(id);
    }
  }
  lendLooks(level, { materials: new ReentrantMaterials([['outer', material]]),
    setParam: id => { writes.push(`level:${id}`); }, setTexture: () => undefined, bindMeshMap: () => material });
  lendLooks(other, { materials: new Map([['outer', material], ['inner', material]]),
    setParam: id => { writes.push(`other:${id}`); }, setTexture: () => undefined, bindMeshMap: () => material });
  try {
    withOwner(level, () => { setLentParam('outer', 'fade', 1); });
    withOwner(other, () => { setLentParam('outer', 'fade', 1); });
    withOwner(level, () => { setLentParam('outer', 'fade', 1); });
    expect(writes).toEqual(['other:inner', 'level:outer', 'other:outer', 'level:outer']);
  } finally { level.dispose(); other.dispose(); material.dispose(); }
});

test('a following compile takes the writes on its line but never answers a lookup (NT4 coarse cover)', () => {
  const world = new Scope('follow-world'), assembly = new Scope('follow-assembly', world), other = new Scope('follow-other');
  const worldLook = new Material(), coarseLook = new Material(), otherLook = new Material(), farLook = new Material();
  const writes: string[] = [];
  const lend = (scope: Scope, label: string, material: Material, follows = false): void => {
    lendLooks(scope, { materials: new Map([['look', material]]),
      setParam: () => { writes.push(label); }, setTexture: () => undefined, bindMeshMap: () => material }, { follows });
  };
  lend(assembly, 'world', worldLook); lend(assembly, 'coarse', coarseLook, true);
  try {
    // unowned (a frame's channel feed): the newest compile and the follower on its line
    setLentParam('look', 'wash', 1);
    expect(writes.splice(0)).toEqual(['world', 'coarse']);
    withOwner(world, () => { setLentParam('look', 'wash', 1); });
    expect(writes.splice(0)).toEqual(['world', 'coarse']);
    expect(lentLook('look')).toBe(worldLook);
    lend(other, 'other', otherLook); lend(other, 'far', farLook, true);
    setLentParam('look', 'wash', 1);
    expect(writes.splice(0)).toEqual(['other', 'far']);
    withOwner(assembly, () => { setLentParam('look', 'wash', 1); expect(lentLook('look')).toBe(worldLook); });
    expect(writes.splice(0)).toEqual(['world', 'coarse']);
  } finally { world.dispose(); other.dispose(); for (const m of [worldLook, coarseLook, otherLook, farLook]) m.dispose(); }
});
