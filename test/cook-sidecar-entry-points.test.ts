// SHARD-COMPAT SP1b4: a host's cook preparation sidecar (`<hash>/<renderer>.tar`) at the app build's catalogue cook, and
// the folder lookup the worker, pins install and the app build share. The worker's child is in
// cook-stale-preparation-worker.test.ts; openShardfile's hit, miss and corrupt in cook-sidecar.test.ts.
// oxlint-disable-next-line import/no-nodejs-modules -- The test owns its product and sidecar folders.
import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Folders under the repository's tmp/.
import {dirname, join, resolve} from 'node:path';
import {afterAll, afterEach, beforeEach, expect, test, vi} from 'vitest';
import {readTar, writeTar} from '@wildshard/format/tar';
import {sidecarIn, sidecarPath, sidecarTar, type CookSidecar} from '../src/cook/game/cookSidecar';
import {cookFilesOnly} from './filesOnlyCook';
import {digest, legacyBrasscap, MOVED, PREPARED, prepared} from './fixtures/stale-preparation';

const SCRATCH = 'cook-sidecar-entry-points';
mkdirSync(`tmp/${SCRATCH}`, {recursive: true});
const root = mkdtempSync(resolve(`tmp/${SCRATCH}/run-`));
afterAll(() => { rmSync(root, {recursive: true, force: true}); });
let warnings: string[] = [];
beforeEach(() => { warnings = []; vi.spyOn(console, 'warn').mockImplementation((line: unknown) => { warnings.push(String(line)); }); });
afterEach(() => { vi.restoreAllMocks(); });

const brasscap = readTar(legacyBrasscap());
const original = writeTar(prepared(brasscap, PREPARED)), hash = digest(original);
function sidecarOn(renderer: string): CookSidecar {
  const again = prepared(brasscap, renderer), cook = again.get('cook.json');
  if (cook === undefined) throw new Error('prepared() wrote no cook.json');
  return {cook, mounts: new Map([...again].filter(([path]) => path.startsWith('mounts/')))};
}
/** A folder of sidecars holding `bytes` for the original on MOVED. */
function sidecars(name: string, bytes: Uint8Array): string {
  const folder = join(root, name);
  mkdirSync(join(folder, hash), {recursive: true}); writeFileSync(join(folder, hash, `${MOVED}.tar`), bytes);
  return folder;
}
/** The original installed as pins install leaves it: its files in a folder, with the pin in validation.json. */
function installed(): string {
  const from = join(root, 'out');
  for (const [path, bytes] of readTar(original)) { const file = join(from, 'brasscap-mesa', path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, bytes); }
  writeFileSync(join(from, 'brasscap-mesa', 'validation.json'), JSON.stringify({pin: {hash, revision: 1}}));
  return from;
}

test('the folder lookup finds only this hash on this renderer, and bad bytes read as a corrupt sidecar', () => {
  const folder = sidecars('lookup', sidecarTar(sidecarOn(MOVED)));
  expect(sidecarPath(folder, hash, MOVED)).toBe(join(folder, hash, `${MOVED}.tar`));
  expect(new TextDecoder().decode(sidecarIn(folder, hash, MOVED)?.cook)).toBe(new TextDecoder().decode(sidecarOn(MOVED).cook));
  for (const [at, on] of [[hash, PREPARED], ['0'.repeat(64), MOVED], ['../x', MOVED], [hash, '../x'], [hash, null], [undefined, MOVED]] as const) {
    expect(sidecarIn(folder, at, on)).toBeUndefined();
  }
  expect(sidecarIn(undefined, hash, MOVED)).toBeUndefined();
  expect(sidecarIn(sidecars('garbage', new TextEncoder().encode('not a tar')), hash, MOVED)).toEqual({cook: new Uint8Array(), mounts: new Map()});
});

test('the app build cooks an installed pin by its sidecar on a hit, and by the stale author lists on a miss or corrupt', {timeout: 120_000}, async () => {
  const from = installed();
  const cooked = async (name: string, bytes: Uint8Array): Promise<void> => {
    warnings = [];
    const cook = await cookFilesOnly(['brasscap-mesa'], `${SCRATCH}/${name}`, {from, build: {rendererRevision: MOVED, sidecars: sidecars(name, bytes)}});
    rmSync(cook.root, {recursive: true, force: true});
  };
  await cooked('hit', sidecarTar(sidecarOn(MOVED)));
  expect(warnings).toContain('prepared by cook: brasscap-mesa');
  expect(warnings.some(line => line.startsWith('stale preparation'))).toBe(false);
  await cooked('miss', sidecarTar(sidecarOn(PREPARED)));
  expect(warnings.filter(line => /^cook preparation miss: brasscap-mesa: /u.test(line)).length).toBeGreaterThan(0);
  expect(warnings.some(line => line.includes('stale preparation'))).toBe(true);
  await cooked('corrupt', new TextEncoder().encode('not a tar'));
  expect(warnings.filter(line => /^cook preparation corrupt: brasscap-mesa: /u.test(line)).length).toBeGreaterThan(0);
  expect(warnings.some(line => line.includes('stale preparation'))).toBe(true);
});
