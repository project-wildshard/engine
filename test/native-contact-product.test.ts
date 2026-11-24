// oxlint-disable import/no-nodejs-modules -- Real local product admission uses owned disk bytes.
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { expect, test } from 'vitest';
import { outputSectionPayloads } from '@wildshard/format/outputFields';
import { parseShardfileField } from '@wildshard/format/shardSchema';
import { parseOutputIndex } from '@wildshard/format/outputIndex';
import { validationSourceBytes } from '@wildshard/format/validationReceipt';
import { emptyShardfile } from '../src/shared/host/author';
import { createNativeProofWorker } from '../src/test/game/headlessWorker';
import { loadHeadlessFolder } from '../src/server/host/headlessFolder';
import { HeadlessSimulation } from '../src/server/host/headless';
import { folderHeadlessSections } from '../src/shared/host/headlessSections';
import { headlessSections } from '@wildshard/format/headlessSections';
import { outputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import { readFolderInput } from '../src/client/game/shardfile/folder';
import { validateCheckedFolderAssets } from '../src/client/game/shardfile/folderChecks';
import { outputIndexEnvelope } from '@wildshard/format/version';

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const native = { id: 'fixture.shell', kind: 'different.kind', label: 'Shell', variants: [
  { id: 'plain', label: 'Plain', rarity: 'common', weight: 1, scale: [1, 1] },
] };
function product(metadata: unknown = { page: [], native: [native] }) {
  const shard = emptyShardfile({slug: 'native-contact', name: 'Native contact', author: 'Test', revision: 1, seed: 1});
  shard.items = parseShardfileField('items', JSON.parse(readFileSync(new URL('./fixtures/native-contact-items.json', import.meta.url), 'utf8')));
  const payloads = new Map([...outputSectionPayloads(shard), ['actors/species-programs', metadata] as const]);
  const files = new Map<string, Uint8Array>();
  const sections = [...payloads].map(([name, value]) => {
    const bytes = validationSourceBytes(value), path = `sections/${name}.json`; files.set(path, bytes);
    return { name, path, schema: `wildshard:${name}@1`, hash: hash(bytes), bytes: bytes.length };
  });
  const index = parseOutputIndex(outputIndexEnvelope({format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: shard.version,
    identity: shard.identity, build: {sourceHash: hash(validationSourceBytes(shard)), validator: 'native-contact-test'}, requires: shard.requires,
    admission: {budgets: shard.budgets, serverBudget: shard.serverBudget, authorCaps: shard.authorCaps, critical: shard.critical, library: shard.library},
    sections, schemas: [], files: [], runtime: null}));
  files.set('shard.json', validationSourceBytes(index));
  return { shard, index, files, payloads };
}
async function onDisk<T>(files: ReadonlyMap<string, Uint8Array>, run: (directory: string) => Promise<T>): Promise<T> {
  const root = resolve('tmp/codex-te2e'); mkdirSync(root, {recursive: true});
  const directory = mkdtempSync(`${root}/native-contact-`);
  try {
    for (const [path, bytes] of files) { const file = resolve(directory, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, bytes); }
    return await run(directory);
  } finally { rmSync(directory, {recursive: true, force: true}); }
}
test('native contact targets pass real Node and client product admission with their complete context', async () => {
  const fixture = product();
  const admitted = await onDisk(fixture.files, loadHeadlessFolder);
  expect(admitted.shardfile.items).toEqual(fixture.shard.items);
  expect(folderHeadlessSections(admitted).get('actors/species-programs')).toEqual(fixture.payloads.get('actors/species-programs'));
  const source = await readFolderInput(fixture.index, {base: 'https://fixture.test/', offline: false, hash: bytes => Promise.resolve(hash(bytes)),
    fetch: url => { const bytes = fixture.files.get(new URL(url).pathname.slice(1)); return Promise.resolve(bytes === undefined ? new Response(null, {status: 404}) : new Response(Uint8Array.from(bytes))); }});
  await validateCheckedFolderAssets(source, new Map(), hash, undefined, undefined, fixture.payloads, false);
  expect(source.items).toEqual(fixture.shard.items);
});
// Format 0.74.0 (ONE-FORMAT OF30 cut B, format cf6ef9f) retired actors/species-programs to plain JSON nothing is typed
// against, so the worker forwards it untouched and no longer refuses its shape; a product's bytes still refuse below.
test('worker context retains defining species values', () => {
  const fixture = product();
  expect(headlessSections(fixture.payloads).get('actors/species-programs')).toEqual(fixture.payloads.get('actors/species-programs'));
});
test('unknown rehashed targets and changed native bytes refuse actual Node product admission', async () => {
  const unknown = product({page: [], native: [{...native, id: native.kind}]});
  await expect(onDisk(unknown.files, loadHeadlessFolder)).rejects.toThrow();
  const forged = product(); forged.files.set('sections/actors/species-programs.json', validationSourceBytes({page: [], native: []}));
  await expect(onDisk(forged.files, loadHeadlessFolder)).rejects.toThrow('hash or size mismatch');
});

test('the real parent and worker admit a native item context before ticking', {timeout: 30000}, async () => {
  const fixture = product();
  await onDisk(fixture.files, async directory => {
    const admitted = await loadHeadlessFolder(directory);
    const prepare = new URL('./fixtures/headless/nativeRuntime.ts', import.meta.url);
    const worker = await createNativeProofWorker(admitted.shardfile, new Map(), prepare, {directory, sections: folderHeadlessSections(admitted)});
    try { expect(worker).toBeDefined(); } finally { await worker.dispose(); }
  });
});

test('descriptor context lookup never reads an authored files getter', () => {
  let reads = 0;
  expect(outputDescriptor({get files() { reads++; return []; }})).toBeUndefined();
  expect(reads).toBe(0);
  expect(outputDescriptor(null)).toBeUndefined();
  expect(outputDescriptor({files: []})).toBeUndefined();
});

test('the public headless session carries native contact context through parent admission', {timeout: 30000}, async () => {
  const fixture = product();
  await onDisk(fixture.files, async directory => {
    const admitted = await loadHeadlessFolder(directory);
    const session = await HeadlessSimulation.create(admitted.shardfile, new Map(), undefined, {deadline: 'advisory', sections: folderHeadlessSections(admitted)});
    try { expect(session.checkpoint).toBeDefined(); } finally { await session.dispose(); }
  });
});
