import { describe, expect, test, vi } from 'vitest';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { splatTierOn } from '../src/client/engine/boot/gpuFiles';
import type { Ktx2Probe } from '../src/client/engine/render/ktx2Probe';
import { cookedSplatLayers, otherTierSplatFiles } from '../src/shared/game/shardfile/wholeInputs';
import { splatLayerFiles, splatLayerKey } from '../src/shared/engine/boot/splatLayerRows';

const verdict = (probe: Partial<Ktx2Probe>) => (): Ktx2Probe => ({ ran: true, note: '', families: {}, formats: [], veto: null, ...probe });
const hash = (c: string): string => c.repeat(64);
const set = (a: string, b: string) => ({ colour: [a, b, a, b].map(hash), normal: [a, b, a, b].map(hash), arm: [a, b, a, b].map(hash) });
const tint = [1, 1, 1];

describe('S4: which splat set a device draws', () => {
  test('a phone that samples ASTC keeps its raw 6×6 set', () => {
    expect(splatTierOn('phone', verdict({ families: { astc: true } }))).toBe('phone');
  });
  test.each([
    ['the extension there, read wrong (the iOS Simulator)', { astc: false, etc2: false }],
    ['no extension at all', { etc2: true }],
  ])('a phone with %s draws the Basis set', (_name, families) => {
    expect(splatTierOn('phone', verdict({ families }))).toBe('desktop');
  });
  test('no verdict changes nothing: a measurement pin stays on the phone set', () => {
    expect(splatTierOn('phone', verdict({ ran: false }))).toBe('phone');
  });
  test('a desktop never probes for it', () => {
    const probe = vi.fn(verdict({}));
    expect(splatTierOn('desktop', probe)).toBe('desktop');
    expect(probe).not.toHaveBeenCalled();
  });
  test('the set it draws stays in its product, and only a shard with a phone set asks', () => {
    const asked = vi.fn((): 'phone' | 'desktop' => 'desktop');
    const props = { splat: { material: 'ground', layers: set('a', 'b'), phone: set('c', 'd'), tints: [tint, tint, tint, tint], boreal: null } } as unknown as Shardfile['props'];
    expect([...otherTierSplatFiles({ props }, asked)].sort()).toEqual([hash('c'), hash('d')]);
    expect(asked).toHaveBeenCalledOnce();
    asked.mockClear();
    const plain = { splat: { material: 'ground', layers: set('a', 'b'), tints: [tint, tint, tint, tint], boreal: null } } as unknown as Shardfile['props'];
    expect(otherTierSplatFiles({ props: plain }, asked).size).toBe(0);
    expect(asked).not.toHaveBeenCalled();
  });
});

describe('S12f2b2: a phone reads the cook\'s own file for a phone layer, never its blob', () => {
  const props = { splat: { material: 'ground', layers: set('a', 'b'), phone: set('c', 'd'), tints: [tint, tint, tint, tint], boreal: null } } as unknown as Shardfile['props'];
  // the table rows the cook wrote (S12f2b1): layer c was UASTC and is cooked; d was hand-made 6×6 and kept
  const rows = splatLayerFiles({ [splatLayerKey(`/shardfiles/pine-hollow/blobs/ktx2/${hash('c')}.ktx2`)]: `/assets/pine-hollow/splat/${hash('c')}.t16384-0123abcd.ktx2`,
    '/assets/tex/x.webp#layer': '/assets/gpu/x-11111111.ktx2' });
  const layer = (ref: string): string | undefined => rows.get(ref);
  test('the cooked layer leaves the phone\'s selection; a layer with no row stays', () => {
    expect([...rows.keys()]).toEqual([hash('c')]);
    expect([...cookedSplatLayers({ props }, () => 'phone', layer)]).toEqual([hash('c')]);
  });
  test('a device drawing the desktop set, or an older cook (no row), reads the blobs as before', () => {
    expect(cookedSplatLayers({ props }, () => 'desktop', layer).size).toBe(0);
    expect(cookedSplatLayers({ props }, () => 'phone', () => undefined).size).toBe(0);
    expect(cookedSplatLayers({ props }, () => 'phone', undefined).size).toBe(0);
  });
});
