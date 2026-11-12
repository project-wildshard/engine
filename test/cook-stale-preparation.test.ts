// J262 (SP1a): a renderer move no longer refuses a cook. A shardfile whose author preparation names another renderer
// fingerprint cooks with that preparation as it is, says `stale preparation`, and writes the same bytes the matching
// renderer would; a preparation that doesn't match its own inputs still refuses. The cook worker's case is its own file,
// cook-stale-preparation-worker.test.ts, so each stays under the 60 s CI file budget (J193).
// oxlint-disable-next-line import/no-nodejs-modules -- The test owns its temporary output directories.
import {existsSync, mkdtempSync, readdirSync, readFileSync, rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- The wrapper's per-run temp root.
import {tmpdir} from 'node:os';
// oxlint-disable-next-line import/no-nodejs-modules -- Output trees are compared by relative path.
import {join, relative} from 'node:path';
import {afterAll, expect, test} from 'vitest';
import {readCookData} from '@wildshard/format/cookData';
import {parseOutputIndex} from '@wildshard/format/outputIndex';
import {writeTar} from '@wildshard/format/tar';
import {validationSourceBytes} from '@wildshard/format/validationReceipt';
import {cookShard, openShardfile, type CookReport} from '../src/cook/game/shardCook';
import {createPartEncoder} from '../src/cook/game/spawnParts';
import {digest, json, legacy, MOVED, PREPARED, prepared} from './fixtures/stale-preparation';

const root = mkdtempSync(join(tmpdir(), 'cook-stale-preparation-'));
const encoder = createPartEncoder();
afterAll(async () => { await encoder.close(); rmSync(root, {recursive: true, force: true}); });
/** Re-point the index at changed `cook.json` bytes, so only the preparation's own binding can catch the change. */
function withCook(files: Map<string, Uint8Array>, cook: Uint8Array): Uint8Array {
  const index = parseOutputIndex(json(files.get('shard.json')));
  files.set('cook.json', cook);
  files.set('shard.json', validationSourceBytes({...index, cook: {path: 'cook.json', hash: digest(cook), bytes: cook.length}}));
  return writeTar(files);
}
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, {recursive: true, withFileTypes: true})) {
    if (entry.isFile()) { const path = join(entry.parentPath, entry.name); out[relative(dir, path)] = digest(readFileSync(path)); }
  }
  return out;
}
async function cook(tarball: Uint8Array, name: string, renderer: string): Promise<{report: CookReport; warned: string[]; files: Record<string, string>}> {
  const out = join(root, name), warned: string[] = [];
  const report = await cookShard(tarball, out, {wireBytes: (_url, bytes) => bytes.length, now: () => 0, encoder, renderer, warn: line => { warned.push(line); }});
  return {report, warned, files: tree(out)};
}

test('a preparation from another renderer opens as stale, a matching one as current, none without one', () => {
  const tarball = writeTar(prepared(PREPARED));
  expect(openShardfile(tarball, {renderer: PREPARED}).preparation).toBe('current');
  expect(openShardfile(tarball, {renderer: MOVED}).preparation).toBe('stale');
  expect(openShardfile(legacy, {renderer: MOVED}).preparation).toBe('none');
  expect(openShardfile(tarball, {preparationOnly: true}).preparation).toBe('none');
});

test('a stale preparation cooks to the same bytes as the matching renderer, and says so', {timeout: 60_000}, async () => {
  const tarball = writeTar(prepared(PREPARED));
  const fast = await cook(tarball, 'current', PREPARED), moved = await cook(tarball, 'stale', MOVED);
  expect(fast.report.preparation).toBe('current');
  expect(fast.warned).not.toContain('stale preparation: template');
  expect(moved.report.preparation).toBe('stale');
  expect(moved.warned).toContain('stale preparation: template');
  // The renderer only names the path: every part, manifest, server pack and loose mount is byte for byte the same.
  expect(Object.keys(moved.files).length).toBeGreaterThan(0);
  expect(moved.files).toEqual(fast.files);
  const {preparation: _fast, seconds: _a, ...fastRest} = fast.report, {preparation: _moved, seconds: _b, ...movedRest} = moved.report;
  expect(movedRest).toEqual(fastRest);
  // The author's recorded programs still ship at their URL, and the fence still shapes the phone's entry set.
  expect(moved.report.loose).toContain('/programs/template.json');
  const entry = (cooked: {report: CookReport}, dir: string): string[] => {
    const row = cooked.report.manifests.find(manifest => manifest.tier === 'phone' && manifest.set === 'entry');
    if (row === undefined) throw new Error('No phone entry manifest');
    return (json(readFileSync(join(root, dir, row.url.slice(1)))) as {files: {url: string}[]}).files.map(file => file.url);
  };
  // The stale cook still goes by the author's fence: its recorded read is in the entry set, and gone when the fence is empty.
  const unfenced = await cook(writeTar(prepared(PREPARED, false)), 'stale-unfenced', MOVED);
  expect(entry(moved, 'stale').some(url => url.startsWith('/assets/stale-proof.bin'))).toBe(true);
  expect(entry(unfenced, 'stale-unfenced').some(url => url.startsWith('/assets/stale-proof.bin'))).toBe(false);
  expect(moved.files['programs/template.json']).toBe(digest(prepared(PREPARED).get('mounts/programs/template.json') ?? new Uint8Array()));
});

test('one changed byte of a stale cook.json still refuses before any part is written', async () => {
  const files = prepared(PREPARED), held = files.get('cook.json');
  if (held === undefined) throw new Error('No preparation');
  files.set('cook.json', new TextEncoder().encode(`${new TextDecoder().decode(held)} `));
  const out = join(root, 'changed-byte');
  await expect(cookShard(writeTar(files), out, {wireBytes: (_url, bytes) => bytes.length, now: () => 0, encoder, renderer: MOVED})).rejects.toThrow(/cook preparation.*wildshard prepare/u);
  expect(existsSync(out)).toBe(false);
});

test('a preparation relabelled to this renderer without re-recording still refuses', async () => {
  const files = prepared(PREPARED), held = readCookData(json(files.get('cook.json')));
  // A forger claims the current renderer; the input hash still binds the one it was recorded on.
  const forged = withCook(files, validationSourceBytes({...held, renderer: MOVED}));
  expect(() => openShardfile(forged, {renderer: MOVED})).toThrow(/stale cook preparation/u);
  const out = join(root, 'forged');
  await expect(cookShard(forged, out, {wireBytes: (_url, bytes) => bytes.length, now: () => 0, encoder, renderer: MOVED})).rejects.toThrow(/stale cook preparation/u);
  expect(existsSync(out)).toBe(false);
});
