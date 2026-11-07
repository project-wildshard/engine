import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { SceneScatterPages } from './sceneScatterPages';

const pose = { x: 1, z: 2, y: 3, yaw: 0, sx: 1, sy: 1, sz: 1, far: 1, r: .1, g: .2, b: .3 };
const encode = (member: string) => new TextEncoder().encode(JSON.stringify({ version: 1, members: [{ id: member, kind: 'poses', rows: [pose] }] }));
const make = (read: (hash: string) => Promise<Uint8Array>, bytes = [encode('first'), encode('second')]) => {
  const hashes = bytes.map((_bytes, index) => `owned-body-${index}`), files = new Map(hashes.map((hash, index) => [`page-${index}`, hash]));
  return { hashes, ctx: { scope: new Scope('scatter-page-owner'), product: {
    hasFile: (name: string): boolean => files.has(name),
    json: async (name: string): Promise<unknown> => {
      const hash=files.get(name);if(hash===undefined)throw new Error('Missing owned fixture file');
      const value: unknown=JSON.parse(new TextDecoder().decode(await read(hash)));return value;
    },
  } } };
};

test('first-use pages start in parallel once, while consumers keep their original ordered cursor', async () => {
  const calls: string[] = [], pending = new Map<string, (bytes: Uint8Array) => void>();
  const { ctx, hashes } = make(hash => { calls.push(hash); return new Promise(resolve => { pending.set(hash, resolve); }); });
  const pages = new SceneScatterPages(ctx, ['page-0', 'page-1', 'page-0']);
  expect(calls).toEqual(hashes);
  const second = hashes[1], first = hashes[0];
  if (first === undefined || second === undefined) throw new Error('Missing exact test page');
  pending.get(second)?.(encode('second')); pending.get(first)?.(encode('first'));
  const firstRows=await pages.poses('page-0', 'first');expect(firstRows).toEqual([pose]);
  expect(Object.isFrozen(firstRows)).toBe(true);expect(Object.isFrozen(firstRows[0])).toBe(true);
  if(firstRows[0]===undefined)throw new Error('Missing owned pose');expect(Reflect.set(firstRows[0],'x',999)).toBe(false);
  expect(await pages.poses('page-1', 'second')).toEqual([pose]);
  expect(await pages.poses('page-0', 'first')).toEqual([pose]);
  expect(calls).toHaveLength(2); await pages.close();
  await expect(pages.poses('page-0', 'first')).rejects.toThrow('Missing prepared');
});

test('a later native-page failure stays at its cursor and close drains every started read', async () => {
  const bytes = [encode('first'), new TextEncoder().encode(JSON.stringify({ version: 1, members: [{ id: 'bad', kind: 'poses', rows: [{ ...pose, x: 'wrong' }] }] }))];
  const { ctx, hashes } = make(hash => {
    const index = hashes.indexOf(hash), body = bytes[index];
    if (body === undefined) throw new Error('Missing test body'); return Promise.resolve(body);
  }, bytes);
  const pages = new SceneScatterPages(ctx, ['page-0', 'page-1']);
  expect(await pages.poses('page-0', 'first')).toEqual([pose]);
  await expect(pages.poses('page-1', 'bad')).rejects.toThrow();
  await expect(pages.close()).resolves.toBeUndefined();
});

test('complete inventory is checked before reads; retirement and changed product owners refuse after await', async () => {
  let reads = 0;
  const first = make(() => { reads++; return Promise.resolve(encode('first')); });
  expect(() => new SceneScatterPages(first.ctx, ['page-0', 'missing'])).toThrow('Missing scene scatter'); expect(reads).toBe(0);
  let finish: (bytes: Uint8Array) => void = () => undefined;
  const owned = make(() => new Promise(resolve => { finish = resolve; }));
  const pages = new SceneScatterPages(owned.ctx, ['page-0']);
  owned.ctx.product = first.ctx.product; finish(encode('first'));
  await expect(pages.poses('page-0', 'first')).rejects.toThrow('owner changed'); await pages.close();
  const retired = make(() => Promise.resolve(encode('first'))), pending = new SceneScatterPages(retired.ctx, ['page-0']);
  retired.ctx.scope.dispose(); await expect(pending.poses('page-0', 'first')).rejects.toThrow('retired'); await pending.close();
});

test('wrong member identity or kind never becomes a pose list', async () => {
  const bytes = [new TextEncoder().encode(JSON.stringify({ version: 1, members: [{ id: 'first', kind: 'spots', rows: [{ x: 1, z: 2, s: 3 }] }] }))];
  const { ctx } = make(() => Promise.resolve(bytes[0] ?? new Uint8Array()), bytes), pages = new SceneScatterPages(ctx, ['page-0']);
  await expect(pages.poses('page-0', 'first')).rejects.toThrow('not a pose');
  await expect(pages.poses('page-0', 'absent')).rejects.toThrow('not a pose'); await pages.close();
});
