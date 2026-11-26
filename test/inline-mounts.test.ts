// MEMORY-GATES MG9 (mini-pinemem5): `wildshard prepare` timed out at 240 s on Pine because its inline candidate declared
// cook-made files (S12d's phone ASTC KTX2s) the preparation client's byte table never listed.
import { expect, test, vi } from 'vitest';
import { adoptInlineMounts, inlineMountBytes } from '../src/client/app/assetTables';
import { installAssetTables, musicManifests, publicBytes, sfxManifests } from '../src/shared/engine/boot/tables';

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

// SHARD-COMPAT SM8 (opus-compat-w9): the showcase template, retired from the pins, had no sfx table row, so its scene
// cue bank refused at level.play ("requires its credit") and prepare timed out at 240 s.
test('an inline candidate adds its own music and sfx manifests to the audio tables', () => withTables(async () => {
  const cook = { mounts: [{ url: '/assets/sfx/showcase-template/sfx.json', path: 'm/a', bytes: 5, hash: 'h' },
    { url: '/assets/music/showcase-template/music.json', path: 'm/b', bytes: 6, hash: 'h' },
    { url: '/assets/sfx/showcase-template/bed-1.m4a', path: 'm/c', bytes: 7, hash: 'h' }] };
  const files: Record<string, unknown> = {
    'http://127.0.0.1:4000/cook.json': cook,
    'http://127.0.0.1:4000/assets/sfx/showcase-template/sfx.json': { credit: 'Sound effects: test', beds: {}, provenance: [{ file: 'x' }] },
    'http://127.0.0.1:4000/assets/music/showcase-template/music.json': { style: 'showcase-template', synth_keeps: 1 },
  };
  const read = vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(files[url]))));
  expect(await adoptInlineMounts({ cook: { path: 'cook.json' } }, 'http://127.0.0.1:4000/', read)).toBe(3);
  expect(read).toHaveBeenCalledTimes(3);
  expect(sfxManifests()).toEqual({ 'showcase-template': { credit: 'Sound effects: test', beds: {} } });
  expect(musicManifests()).toEqual({ 'showcase-template': { style: 'showcase-template' } });
  expect(publicBytes()['/assets/sfx/showcase-template/bed-1.m4a']).toBe(7);
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

// SF4 (standalone shardfiles): a re-packed zone mounts its audio under its own name; the table row keeps that folder.
test('an inline candidate adds its zone-scoped audio manifests with their folders', () => withTables(async () => {
  const cook = { mounts: [{ url: '/assets/open-plot-sky-race/sfx/sky-race/sfx.json', path: 'm/a', bytes: 5, hash: 'h' },
    { url: '/assets/open-plot-sky-race/music/sky-race/music.json', path: 'm/b', bytes: 6, hash: 'h' }] };
  const files: Record<string, unknown> = {
    'http://127.0.0.1:4000/cook.json': cook,
    'http://127.0.0.1:4000/assets/open-plot-sky-race/sfx/sky-race/sfx.json': { beds: {}, provenance: [] },
    'http://127.0.0.1:4000/assets/open-plot-sky-race/music/sky-race/music.json': { style: 'sky-race' },
  };
  const read = vi.fn((url: string) => Promise.resolve(new Response(JSON.stringify(files[url]))));
  expect(await adoptInlineMounts({ cook: { path: 'cook.json' } }, 'http://127.0.0.1:4000/', read)).toBe(2);
  expect(sfxManifests()).toEqual({ 'sky-race': { beds: {}, $dir: '/assets/open-plot-sky-race/sfx/sky-race/' } });
  expect(musicManifests()).toEqual({ 'sky-race': { style: 'sky-race', $dir: '/assets/open-plot-sky-race/music/sky-race/' } });
}));
