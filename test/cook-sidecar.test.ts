// SHARD-COMPAT SP1b2: a cook preparation sidecar recorded on this renderer stands in for a stale author preparation; one
// for another renderer is a miss and one whose bytes don't hold is corrupt, and both fall back to the stale path (SP1a).
import {expect, test} from 'vitest';
import {readTar, writeTar} from '@wildshard/format/tar';
import {openShardfile} from '../src/cook/game/shardCook';
import type {CookSidecar} from '../src/cook/game/cookSidecar';
import {legacyBrasscap, MOVED, PREPARED, prepared} from './fixtures/stale-preparation';

const brasscap = readTar(legacyBrasscap());
/** The author recorded on PREPARED; the cook runs on MOVED. */
const original = writeTar(prepared(brasscap, PREPARED));
/** A sidecar: the same shard prepared again on `renderer`, its cook.json and every mount under `mounts/`. */
function sidecarOn(renderer: string): CookSidecar {
  const again = prepared(brasscap, renderer), cook = again.get('cook.json');
  if (cook === undefined) throw new Error('prepared() wrote no cook.json');
  return {cook, mounts: new Map([...again].filter(([path]) => path.startsWith('mounts/')))};
}

test('a sidecar on this renderer is taken: the shard opens prepared by cook, on the sidecar lists', () => {
  const warned: string[] = [], sidecar = sidecarOn(MOVED);
  const shard = openShardfile(original, {renderer: MOVED, sidecar, warn: line => { warned.push(line); }});
  expect(shard.preparation).toBe('cook');
  expect(shard.cook?.version === 3 ? shard.cook.renderer : undefined).toBe(MOVED);
  expect(warned).toEqual([]);
});

test('a sidecar on another renderer is a miss and the cook goes by the stale author lists', () => {
  const warned: string[] = [];
  const shard = openShardfile(original, {renderer: MOVED, sidecar: sidecarOn('5e5e5e5e'.padEnd(64, '0')), warn: line => { warned.push(line); }});
  expect(shard.preparation).toBe('stale');
  expect(warned).toEqual([expect.stringMatching(/^cook preparation miss: brasscap-mesa: recorded on 5e5e5e5e/u)]);
});

test('a sidecar whose cook.json or mount bytes do not hold is corrupt and changes nothing', () => {
  const good = sidecarOn(MOVED), warned: string[] = [], warn = (line: string): void => { warned.push(line); };
  const garbled: CookSidecar = {cook: new TextEncoder().encode('{"version":'), mounts: good.mounts};
  const mounts = new Map(good.mounts), [first] = [...mounts.keys()].filter(path => path.startsWith('mounts/programs/'));
  if (first === undefined) throw new Error('no program mount');
  mounts.set(first, new TextEncoder().encode('not the recorded programs'));
  expect(openShardfile(original, {renderer: MOVED, sidecar: garbled, warn}).preparation).toBe('stale');
  expect(openShardfile(original, {renderer: MOVED, sidecar: {cook: good.cook, mounts}, warn}).preparation).toBe('stale');
  expect(warned).toEqual([expect.stringMatching(/^cook preparation corrupt: brasscap-mesa: its cook.json does not read$/u),
    expect.stringMatching(/^cook preparation corrupt: brasscap-mesa: /u)]);
});

test('a current author preparation never reads the sidecar', () => {
  expect(openShardfile(original, {renderer: PREPARED, sidecar: sidecarOn(MOVED)}).preparation).toBe('current');
});
