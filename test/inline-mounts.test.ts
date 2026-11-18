// MEMORY-GATES MG9 (mini-pinemem5): `wildshard prepare` timed out at 240 s on Pine because its inline candidate declared
// cook-made files (S12d's phone ASTC KTX2s) the preparation client's byte table never listed.
import { expect, test, vi } from 'vitest';
import { adoptInlineMounts, inlineMountBytes } from '../src/client/app/assetTables';
import { installAssetTables, publicBytes } from '../src/shared/engine/boot/tables';

const SLOT = Symbol.for('engine.asset-tables');
function withTables(run: () => Promise<void>): Promise<void> {
  const previous: unknown = Reflect.get(globalThis, SLOT);
  installAssetTables({ bytes: { '/assets/kept.bin': 42 }, versions: { '/assets/kept.bin': 'abc' }, music: {}, sfx: {}, packs: {} });
  return run().finally(() => { if (previous === undefined) Reflect.deleteProperty(globalThis, SLOT); else Reflect.set(globalThis, SLOT, previous); });
}

test('an inline candidate adds its cook mounts to the byte table', () => withTables(async () => {
  const cook = { mounts: [{ url: '/assets/gpu/models/trees/cards.phone-1210f7ed.ktx2', path: 'mounts/assets/x.ktx2', bytes: 7, hash: 'h' },
    { url: '/programs/pine-hollow.json', path: 'mounts/programs/pine-hollow.json', bytes: 9, hash: 'h' }] };
  const read = vi.fn((_url: string) => Promise.resolve(new Response(JSON.stringify(cook))));
  expect(await adoptInlineMounts({ cook: { path: 'cook.json', hash: 'h', bytes: 1 } }, 'http://127.0.0.1:4000/', read)).toBe(2);
  expect(read).toHaveBeenCalledExactlyOnceWith('http://127.0.0.1:4000/cook.json');
  expect(publicBytes()).toEqual({ '/assets/kept.bin': 42, '/assets/gpu/models/trees/cards.phone-1210f7ed.ktx2': 7, '/programs/pine-hollow.json': 9 });
}));

test('a candidate with no cook reads nothing and keeps the table', () => withTables(async () => {
  const read = vi.fn((_url: string) => Promise.resolve(new Response('{}')));
  expect(await adoptInlineMounts({ identity: { slug: 'x' } }, 'http://127.0.0.1:4000/', read)).toBe(0);
  expect(await adoptInlineMounts(null, 'http://127.0.0.1:4000/', read)).toBe(0);
  expect(read).not.toHaveBeenCalled();
  expect(publicBytes()).toEqual({ '/assets/kept.bin': 42 });
}));

test('an unreadable cook or a bad mount refuses and installs nothing', () => withTables(async () => {
  const missing = vi.fn((_url: string) => Promise.resolve(new Response('', { status: 404 })));
  await expect(adoptInlineMounts({ cook: { path: 'cook.json' } }, 'http://127.0.0.1:4000/', missing)).rejects.toThrow('Inline candidate cook unreadable: 404');
  expect(() => inlineMountBytes({ mounts: [{ url: '/assets/../x', bytes: 1 }] })).toThrow('Invalid inline candidate mount');
  expect(() => inlineMountBytes({ mounts: [{ url: 'assets/x', bytes: 1 }] })).toThrow('Invalid inline candidate mount');
  expect(() => inlineMountBytes({ mounts: [{ url: '/assets/x', bytes: -1 }] })).toThrow('Invalid inline candidate mount');
  expect(() => inlineMountBytes({})).toThrow('Inline candidate cook has no mounts');
  expect(publicBytes()).toEqual({ '/assets/kept.bin': 42 });
}));
