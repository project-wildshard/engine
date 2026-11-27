// SHARD-COMPAT FE9d (J486): a `renameKind` step cooks identical except the renamed bytes. A stored original that spells
// one kind by an old name is refused by today's reader, so the cook runs the chain; a step that renames the old spelling
// to today's makes a copy whose cook is the same tree, byte for byte, as the original written with today's name. No
// shipped format has renamed a kind yet, so the rename is seeded: the original carries `region` as `region-old`, and the
// chain carries one test step, run through the cook's own admission (`runCookJob`'s `migrations` port).
// oxlint-disable-next-line import/no-nodejs-modules -- Hash the seeded section as the index records it.
import {createHash} from 'node:crypto';
// oxlint-disable-next-line import/no-nodejs-modules -- The cooks write trees this test compares.
import {readdirSync, readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Output trees compare by relative path.
import {join, relative} from 'node:path';
import {describe, expect, it} from 'vitest';
import {FORMAT_MIGRATIONS, type FormatMigration, type MigratingShard} from '@wildshard/format/formatMigrations';
import {migrateShardfile} from '@wildshard/format/migrate';
import {readTar, writeTar} from '@wildshard/format/tar';
import {validationSourceBytes} from '@wildshard/format/validationReceipt';
import {runCookJob, ShardfileRefusedError, type CookJobPorts} from '../src/cook/game/cookJob';
import {checkShardfile} from '../src/server/host/checkShardfile';
import {hashOf, legacyMigrationFixture, useCookHarness} from './fixtures/cookWorkerHarness';

const OLD = 'region-old', NEW = 'region', SECTION = 'sections/quests/quests.json';
const last = FORMAT_MIGRATIONS.at(-1);
if (last === undefined) throw new Error('the format ships no migration');

/** Every `kind` equal to `from`, anywhere in a value, becomes `to` (format-migration-ops' renameKind on `kind`). */
function renamed(value: unknown, from: string, to: string): void {
  if (Array.isArray(value)) { for (const item of value) renamed(item, from, to); return; }
  if (typeof value !== 'object' || value === null) return;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'kind' && item === from) Reflect.set(value, key, to);
    else renamed(item, from, to);
  }
}
const carriesOld = (shard: Readonly<MigratingShard>): boolean => [...shard.sections.values()].some(value => JSON.stringify(value).includes(`"kind":"${OLD}"`));
const renameStep: FormatMigration = {
  id: 'fe9d-test-rename-region', to: last.to, touches: 'data', affects: [],
  apply: (shard: MigratingShard): void => { for (const value of [...shard.sections.values(), ...shard.mounts.values()]) renamed(value, OLD, NEW); },
  repairs: carriesOld,
};
const chain = [...FORMAT_MIGRATIONS, renameStep];

/** The original with its quest section's text edited by `edit`, its index row re-hashed so it still passes its own inventory. */
function edited(real: Uint8Array, edit: (text: string) => string): Uint8Array {
  const files = new Map(readTar(real)), bytes = files.get(SECTION), header = files.get('shard.json');
  if (bytes === undefined || header === undefined) throw new Error(`no ${SECTION}`);
  const text = new TextDecoder().decode(bytes), old = edit(text);
  if (old === text) throw new Error(`${SECTION} did not change`);
  const changed = new TextEncoder().encode(old), index: unknown = JSON.parse(new TextDecoder().decode(header));
  if (typeof index !== 'object' || index === null || !('sections' in index) || !Array.isArray(index.sections)) throw new Error('no sections');
  for (const row of index.sections as {path: string; hash: string; bytes: number}[]) {
    if (row.path === SECTION) { row.hash = createHash('sha256').update(changed).digest('hex'); row.bytes = changed.length; }
  }
  // The made-up product packs its sections; an edited section leaves its pack, so the copy ships the sections loose.
  Reflect.deleteProperty(index, 'packs');
  for (const name of [...files.keys()]) if (name.startsWith('blobs/pack/')) files.delete(name);
  files.set(SECTION, changed); files.set('shard.json', new TextEncoder().encode(`${JSON.stringify(index)}\n`));
  return writeTar(files);
}
/** ZONE-SNAPSHOTS ZS8: the made-up product holds no region trigger, so one is written in (today's spelling). */
const withRegion = (real: Uint8Array): Uint8Array => edited(real, text => text.replace('"flags":[]', '"flags":["made-up.zone"]')
  .replace('"triggers":[]', `"triggers":[{"flag":"made-up.zone","id":"made-up.zone","kind":"${NEW}","radius":4,"x":0,"z":0}]`));
/** The original with its one region kind spelt the old way. */
const seeded = (real: Uint8Array): Uint8Array => edited(withRegion(real), text => text.replace(`"kind":"${NEW}"`, `"kind":"${OLD}"`));
function tree(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const entry of readdirSync(dir, {recursive: true, withFileTypes: true})) {
    if (entry.isFile()) { const path = join(entry.parentPath, entry.name); out[relative(dir, path)] = hashOf(readFileSync(path)); }
  }
  return out;
}
const ports = (migrations?: readonly FormatMigration[]): CookJobPorts => ({
  check: (shard, assets, sections) => checkShardfile(shard, assets, {sections}), wireBytes: (_url, bytes) => bytes.length, now: () => 0,
  ...(migrations === undefined ? {} : {migrations}),
});

function withShardVersion(tarball: Uint8Array, shardVersion: string): Uint8Array {
  const files = new Map(readTar(tarball)), bytes = files.get('shard.json');
  if (bytes === undefined) throw new Error('Missing fixture index');
  const raw: unknown = JSON.parse(new TextDecoder().decode(bytes));
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('Invalid fixture index');
  files.set('shard.json', validationSourceBytes({...raw, shardVersion}));
  return writeTar(files);
}

describe('a renameKind step through the cook (FE9d)', () => {
  const h = useCookHarness(legacyMigrationFixture.folder);

  it('copies the authored version into the published cook metadata and binds its bytes', async () => {
    const shardVersion = '2.3.4-rc.1';
    const tar = withShardVersion(writeTar(migrateShardfile(readTar(withRegion(h.real)), {hash: hashOf}).files), shardVersion);
    const output = join(h.scratch, 'versioned');
    const report = await runCookJob(tar, output, {...ports(chain), shardVersion: '1.0.0'});
    const header = join(output, 'client', report.header);
    const metadata = readFileSync(join(header, '..', 'cook.json'));
    expect(JSON.parse(metadata.toString('utf8'))).toMatchObject({shardVersion});
    expect(JSON.parse(readFileSync(header, 'utf8'))).toMatchObject({cook: {path: 'cook.json', bytes: metadata.length, hash: hashOf(metadata)}});
  }, 120_000);

  it('refuses the old spelling when no step renames it', async () => {
    await expect(runCookJob(seeded(h.real), join(h.scratch, 'unrenamed'), ports())).rejects.toThrow(ShardfileRefusedError);
  }, 120_000);

  it('cooks the renamed copy byte for byte as the original with today\'s name', async () => {
    // The original as today's format writes it: the registry's own chain, so the cook takes it as it is.
    const today = writeTar(migrateShardfile(readTar(withRegion(h.real)), {hash: hashOf}).files);
    const version = {shardVersion: '1.2.3-rc.1'};
    const plain = await runCookJob(today, join(h.scratch, 'plain'), {...ports(chain), ...version});
    expect(JSON.parse(readFileSync(join(h.scratch, 'plain/client', plain.header, '..', 'cook.json'), 'utf8'))).toMatchObject(version);
    expect(plain.provenance?.applied ?? []).toEqual([]);
    const copy = await runCookJob(seeded(h.real), join(h.scratch, 'renamed'), {...ports(chain), ...version});
    expect(copy.hash).not.toBe(plain.hash);
    expect(copy.provenance?.applied).toContain(renameStep.id);
    expect(tree(join(h.scratch, 'renamed'))).toEqual(tree(join(h.scratch, 'plain')));
  }, 120_000);
});
