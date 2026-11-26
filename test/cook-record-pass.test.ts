// SHARD-COMPAT SP1b-T: the box cook's record pass from its environment. Off, it names the missing setting and records
// nothing; on, `recook`'s first step runs the real recorder port (a stand-in `wildshard` process) over the catalogue,
// canary first, and every stale head gets the sidecar its job then reads.
// oxlint-disable-next-line import/no-nodejs-modules -- The test owns its folders.
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Folders under the repository's tmp/.
import {dirname, join, resolve} from 'node:path';
import {afterAll, expect, test} from 'vitest';
import {readTar, writeTar} from '@wildshard/format/tar';
import {readSidecarTar} from '../src/cook/game/cookSidecar';
import {cookSidecars, recordPass, recordPorts} from '../src/cook/game/recordPass';
import {openShardfile} from '../src/cook/game/shardCook';
import {digest, legacyBrasscap, MOVED, PREPARED, prepared} from './fixtures/stale-preparation';

mkdirSync('tmp/cook-record-pass', {recursive: true});
const root = mkdtempSync(resolve('tmp/cook-record-pass/run-'));
afterAll(() => { rmSync(root, {recursive: true, force: true}); });
const quiet = (): void => {};

test('the pass is off until the host names a sidecar folder, a recorder, its client and a canary', () => {
  const full = {COOK_SIDECARS: 'tmp/sidecars', COOK_RECORDER: '["wildshard"]', COOK_PREPARATION_CLIENT: 'tmp/client', COOK_RECORD_CANARY: 'brasscap-mesa'};
  expect(cookSidecars({})).toBeUndefined();
  expect(cookSidecars({COOK_SIDECARS: ''})).toBeUndefined();
  expect(cookSidecars({COOK_SIDECARS: 'tmp/sidecars'})).toBe(resolve('tmp/sidecars'));
  const off = (env: Record<string, string>): unknown => recordPorts(env, MOVED, root, quiet);
  expect(off({})).toEqual({off: 'no COOK_SIDECARS'});
  expect(recordPorts(full, undefined, root, quiet)).toEqual({off: 'no renderer uploadNumber'});
  expect(off({...full, COOK_RECORDER: ''})).toEqual({off: 'no COOK_RECORDER'});
  expect(off({...full, COOK_PREPARATION_CLIENT: ''})).toEqual({off: 'no COOK_PREPARATION_CLIENT'});
  expect(off({...full, COOK_RECORD_CANARY: ''})).toEqual({off: 'no COOK_RECORD_CANARY'});
  expect(() => off({...full, COOK_RECORDER: '"wildshard"'})).toThrow('COOK_RECORDER must be a JSON array of strings');
  const on = recordPorts({...full, COOK_RECORD_ACCEPTED: 'aa, bb'}, MOVED, root, quiet);
  if ('off' in on) throw new Error(on.off);
  expect(on.canary).toBe('brasscap-mesa');
  expect(on.ports).toMatchObject({renderer: MOVED, sidecars: resolve('tmp/sidecars'), scratch: join(root, 'record'), accepted: new Set(['aa', 'bb'])});
});

test('a recook records every stale head first through the recorder process, and its job then reads the sidecar', async () => {
  const brasscap = readTar(legacyBrasscap());
  const head = (slug: string, fenced: boolean, renderer = PREPARED): {slug: string; hash: string; tarball: Uint8Array} => {
    const tarball = writeTar(prepared(brasscap, renderer, fenced));
    return {slug, hash: digest(tarball), tarball};
  };
  const canary = head('brasscap-mesa', true), other = head('brasscap-other', false), current = head('brasscap-new', true, MOVED);
  // The stand-in `wildshard prepare <folder>`: copies what the real recorder writes on MOVED for that folder's fence.
  const recorded = join(root, 'recorded');
  for (const fenced of [true, false]) {
    for (const [path, bytes] of prepared(brasscap, MOVED, fenced)) {
      const file = join(recorded, String(fenced), path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, bytes);
    }
  }
  const script = join(root, 'wildshard.cjs');
  writeFileSync(script, [
    "const fs = require('node:fs'), path = require('node:path'), dir = process.argv.at(-1);",
    "const fenced = JSON.parse(fs.readFileSync(path.join(dir, 'cook.json'), 'utf8')).fence.length > 0;",
    `fs.cpSync(path.join(${JSON.stringify(recorded)}, String(fenced)), dir, {recursive: true});`,
  ].join('\n'));
  const byHash = new Map([canary, other, current].map(row => [row.hash, row.tarball]));
  const source = {heads: (stage: string) => Promise.resolve(stage === 'live' ? [canary, other].map(row => ({slug: row.slug, hash: row.hash, uploadNumber: 1})) : stage === 'staging' ? [{slug: current.slug, hash: current.hash, uploadNumber: 1}] : []),
    download: (hash: string) => { const bytes = byHash.get(hash); return bytes === undefined ? Promise.reject(new Error('unknown')) : Promise.resolve(bytes); }};
  const sidecars = join(root, 'sidecars'), lines: string[] = [];
  const env = {COOK_SIDECARS: sidecars, COOK_RECORDER: JSON.stringify([process.execPath, script]), COOK_PREPARATION_CLIENT: join(root, 'client'), COOK_RECORD_CANARY: 'brasscap-mesa', COOK_JOB_WRAP: '[]'};
  expect(await recordPass({}, MOVED, root, source, line => { lines.push(line); })).toEqual([]);
  expect(lines).toEqual(['record pass off: no COOK_SIDECARS']);
  const rows = await recordPass(env, MOVED, root, source, line => { lines.push(line); });
  expect(rows.map(row => `${row.slug} ${row.state}`)).toEqual(['brasscap-mesa recorded', 'brasscap-other recorded', 'brasscap-new current']);
  expect(lines).toContain('canary equal: brasscap-mesa');
  for (const shard of [canary, other]) {
    const sidecar = readSidecarTar(readFileSync(join(sidecars, shard.hash, `${MOVED}.tar`)));
    expect(openShardfile(shard.tarball, {renderer: MOVED, sidecar}).preparation).toBe('cook');
  }
  expect(existsSync(join(sidecars, current.hash))).toBe(false);
});
