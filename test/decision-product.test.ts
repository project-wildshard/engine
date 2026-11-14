import { afterEach, beforeAll, expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- The test owns its small author/output directories.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- All paths stay inside the owned fixture.
import { resolve } from 'node:path';
import { emptyShardfile } from '../src/shared/host/author';
import { compileScript } from '@wildshard/sharddev/compileScript';
import { nameBlob, emitNamedBlobs, readNamedBlob } from '../src/sharddev/blobs';
import { buildProject } from '../src/sharddev/project';
import { mergeProjectBlobs, prepareProjectOutput } from '../src/sharddev/projectOutput';
import { emitPlatformSections } from '../src/sharddev/platformSections';
import { writeOutputFolder, validateOutputFolder } from '../src/sharddev/outputFolder';
import { encodeCanonicalJson, hashImmutableBytes } from '../src/shared/host/immutable';
import { admitFolder as admitBrowser, readFolderDescriptor, type FolderOptions } from '../src/client/game/shardfile/folder';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import { admitScriptContract, decisionModuleContracts, decisionScriptsFromSections } from '@wildshard/format/scriptContract';
import { assetCost } from '@wildshard/format/shardfileAssets';
import { validateShardfileAssets } from '@wildshard/format/assetAdmission';
import { HeadlessSimulation } from '../src/server/host/headless';
import { FIXTURE_RUNTIME_COST } from './fixtures/clientPlanRuntime';

let bytes: Uint8Array = new Uint8Array();
const directories: string[] = [];
function directory(): string { mkdirSync('tmp', { recursive: true }); const path = mkdtempSync(resolve('tmp/decision-product-')); directories.push(path); return path; }
function rows(hash: string, pages = 2, moves: Readonly<Record<string, string>> = {}) { return parseDecisionScripts([{ id: 'sample', abi: '1.0', side: 'sim', module: `blobs/wasm/${hash}.wasm`, source: 'behaviour/sample.as', binding: { shard: true }, pages, onFail: 'hold', on: ['start'], reads: [], commands: [], moves, stateVersion: 1, state: [], params: {} }]); }
const MOVES = [{ id: 'sample.approach', kind: 'stalk', speed: 1, turn: 4, ground: true, above: 0, standOff: 0, ready: { kind: 'range' } }];
function fixture() {
  const blob = nameBlob('behaviour/sample.wasm', 'wasm', bytes, { script: { abi: 1, pages: 2 }, critical: true });
  const source = emptyShardfile({ slug: 'decision-test', name: 'Decision', author: 'Test', revision: 1, seed: 2 });
  source.budgets.sim.resident = 1_000_000;
  const merged = mergeProjectBlobs(source, new Map(), [blob]);
  const scripts = rows(blob.file.hash), platform = emitPlatformSections(new Map([['sim/scripts', scripts]]));
  return { ...merged, blob, scripts, platform };
}
beforeAll(async () => { bytes = await compileScript(`
export function ws_abi():i32 { return 1; }
export function ws_init(lo:i32,hi:i32):void {}
export function ws_io():i32 { return 16384; }
export function ws_handle():i32 { return 0; }`, { abi: 1, maximumPages: 2 }); });
afterEach(() => { for (const path of directories.splice(0)) rmSync(path, { recursive: true }); });

test('native workers admit explicitly declared v1 sections without inferring an ABI', async () => {
  const { shard, assets, scripts } = fixture();
  await expect(HeadlessSimulation.create(shard, assets)).rejects.toThrow('ABI');
  const sections = new Map<string, unknown>([['sim/scripts', scripts], ['actors/moves', []]]);
  const sim = await HeadlessSimulation.create(shard, assets, undefined, { deadline: 'advisory', sections });
  try { expect((await sim.step()).tick).toBe(1); expect(sim.quarantined).toBe(false); }
  finally { await sim.dispose(); }
});

test('source and in-memory named bytes retain explicit contracts, without an index ABI field', async () => {
  const { blob, platform } = fixture(), root = directory(); writeFileSync(resolve(root, 'sample.wasm'), bytes);
  const loaded = await readNamedBlob(root, 'behaviour/sample.wasm', 'sample.wasm', 'wasm', { script: { abi: 1, pages: 2 }, critical: true });
  expect(loaded).toEqual(blob);
  expect(emitNamedBlobs([loaded]).files[0]).not.toHaveProperty('abi');
  expect(() => nameBlob('missing.wasm', 'wasm', bytes)).toThrow('explicit script contract');
  expect(() => nameBlob('wrong.wasm', 'wasm', bytes, { script: { abi: 0 } })).toThrow();
  expect(() => assetCost('wasm', new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]), { abi: 0 })).toThrow();
  expect(() => admitScriptContract(bytes, { abi: 1, pages: 1 })).toThrow('fixed pages');
  const checked = await prepareProjectOutput(root, { platform, namedFiles: [blob.file], assets: new Map([[blob.file.hash, bytes]]) });
  expect(checked.blobs[0]?.script).toEqual({ abi: 1, pages: 2 });
  const fromSource = await prepareProjectOutput(root, { platform, blobs: [{ name: 'behaviour/sample.wasm', kind: 'wasm', source: 'sample.wasm', options: { script: { abi: 1, pages: 2 }, critical: true } }] });
  expect(fromSource.blobs[0]).toEqual(blob);
});

test('writer, disk validator and untrusted browser use the exact verified sim/scripts contract', async () => {
  const { shard, assets, namedFiles, platform, blob, scripts } = fixture(), root = directory();
  const index = writeOutputFolder(shard, assets, root, { namedFiles, platform });
  expect(validateOutputFolder(root).assets.get(blob.file.hash)).toEqual(bytes);
  const base = 'https://example.test/decision/';
  const options: FolderOptions = { base, offline: false, firstParty: false, hash: wire => Promise.resolve(hashImmutableBytes(wire)), fetch: url => {
    const path = url.slice(base.length); return Promise.resolve(new Response(Uint8Array.from(readFileSync(resolve(root, path)))));
  } };
  const source = await readFolderDescriptor(options);
  expect((await admitBrowser(source, options)).assets.get(blob.file.hash)).toEqual(bytes);
  expect(() => validateShardfileAssets(shard, assets, hashImmutableBytes, undefined, undefined, scripts)).not.toThrow();
  expect(() => writeOutputFolder(shard, assets, directory())).toThrow();
  expect(() => writeOutputFolder(shard, assets, directory(), { platform: emitPlatformSections(new Map([['sim/scripts', rows(blob.file.hash, 1)]])) })).toThrow('fixed pages');
  const decisionSection = index.sections.find(value => value.name === 'sim/scripts');
  if (decisionSection === undefined) throw new Error('Missing decision section');
  const wrong = new TextEncoder().encode(encodeCanonicalJson(rows(blob.file.hash, 1)));
  writeFileSync(resolve(root, decisionSection.path), wrong); decisionSection.hash = hashImmutableBytes(wrong); decisionSection.bytes = wrong.length;
  // the rewritten section no longer matches its pack (I5), which refuses first; this case checks the section contract
  const { packs: _packs, ...unpacked } = index;
  writeFileSync(resolve(root, 'shard.json'), encodeCanonicalJson(unpacked));
  expect(() => validateOutputFolder(root)).toThrow('fixed pages');
  await expect(admitBrowser(await readFolderDescriptor(options), options)).rejects.toThrow('fixed pages');
});


test('project build carries source declaration contracts and their bound moves through its real writer', async () => {
  const root = directory(), source = emptyShardfile({ slug: 'decision-project', name: 'Decision', author: 'Test', revision: 1, seed: 2 });
  source.budgets.sim.resident = 1_000_000;
  // The author compiler builds the row's module from its declared AssemblyScript source.
  mkdirSync(resolve(root, 'behaviour')); writeFileSync(resolve(root, 'behaviour/sample.as'), 'export function onStart():void {}');
  writeFileSync(resolve(root, 'shard.config.ts'), `
import { emitPlatformSections } from '@wildshard/sharddev/platformSections';
export default ${JSON.stringify(source)};
export const buildOptions = { asLineCeiling: 1 };
export const output = {
 platform: emitPlatformSections(new Map([['sim/scripts', ${JSON.stringify(rows(hashImmutableBytes(bytes), 2, { approach: 'sample.approach' }))}], ['actors/moves', ${JSON.stringify(MOVES)}]]))
};`);
  let declared = 0, ticked = 0;
  const destination = resolve(root, 'out');
  // The CLI's admission starts a native worker from these sections; a row binding a move must find it there.
  await buildProject(root, destination, { client: null, admit: async (shard, assets, _policy, sections) => {
    declared = decisionScriptsFromSections(sections).length;
    const sim = await HeadlessSimulation.create(shard, assets, undefined, { deadline: 'advisory', sections });
    try { ticked = (await sim.step()).tick; } finally { await sim.dispose(); }
  } });
  expect(declared).toBe(1);
  expect(ticked).toBe(1);
  // An unknown binding still refuses: the same row without its moves section.
  const { shard, assets } = fixture();
  const unbound = new Map<string, unknown>([['sim/scripts', rows(hashImmutableBytes(bytes), 2, { approach: 'sample.approach' })]]);
  await expect(HeadlessSimulation.create(shard, assets, undefined, { deadline: 'advisory', sections: unbound })).rejects.toThrow('Missing moves registry target for approach');
  expect(validateOutputFolder(destination).index.files[0]?.kind).toBe('wasm');
  // A platform row can also refer to an existing root declaration, without a named-blob overlay.
  await expect(prepareProjectOutput(root, { platform: fixture().platform })).resolves.toMatchObject({ blobs: [] });
});

test('unlisted modules, conflicting contracts, legacy host mixing and memory understatement refuse', () => {
  const { shard, assets, scripts, blob } = fixture();
  expect(() => decisionScriptsFromSections(new Map([['sim/scripts', null]]))).toThrow();
  expect(() => decisionModuleContracts(scripts, [{ ...blob.file, hash: 'a'.repeat(64) }])).toThrow('exact declared');
  expect(() => decisionModuleContracts(rows('a'.repeat(64)), shard.files)).toThrow('exact declared');
  expect(() => decisionModuleContracts(scripts, [{ ...blob.file, path: `blobs/bin/${blob.file.hash}.bin` }])).toThrow('exact declared');
  const second = scripts[0]; if (second === undefined) throw new Error('Missing row');
  expect(() => decisionModuleContracts([...scripts, { ...second, id: 'other', pages: 1 }], shard.files)).toThrow('Conflicting');
  expect(() => validateShardfileAssets({ ...shard, sim: { ...shard.sim, scripts: [blob.file.hash] } }, assets, hashImmutableBytes, undefined, undefined, scripts)).toThrow('legacy script host');
  shard.budgets.sim.resident = bytes.length + 2 * 65536 * 2 - 1;
  expect(() => validateShardfileAssets(shard, assets, hashImmutableBytes, undefined, undefined, scripts)).toThrow('memory budget');
});


test('runtime-owned encounters admit numeric fields only for their actual sim guest', () => {
  const { shard, assets, scripts } = fixture(), script = scripts[0];
  if (script === undefined) throw new Error('Missing guest');
  shard.runtime = { kind: 'client-plan', cost: FIXTURE_RUNTIME_COST, binds: ['state', 'spawns'], spawns: { homes: [], actors: [],
    bosses: [{ id: 'actor.retained', kind: 'animal', look: 'animal', at: [0, 0], yaw: 0 }] } };
  shard.state.shared = [{ id: 1, name: 'pose', type: 'f64', privacy: 'public', default: 0, min: 0, max: 1 }];
  const guest = { ...script, actors: { self: 'actor.retained' }, fields: { pose: 'pose' } };
  const admit = () => validateShardfileAssets(shard, assets, hashImmutableBytes, undefined, undefined, [guest]);
  expect(admit).not.toThrow();
  shard.state.shared.push({ id: 2, name: 'unowned', type: 'f64', privacy: 'public', default: 0 });
  expect(admit).toThrow('actual declared sim guest'); shard.state.shared.pop();
  expect(() => validateShardfileAssets(shard, assets, hashImmutableBytes, undefined, undefined,
    [{ ...guest, actors: { self: 'actor.other' } }])).toThrow('actual declared sim guest');
  shard.state.shared = [{ id: 1, name: 'pose', type: 'string', privacy: 'public', default: '' }];
  expect(admit).toThrow();
  shard.state.shared = []; shard.state.player = [{ id: 1, name: 'pose', type: 'f64', privacy: 'public', default: 0 }];
  expect(admit).toThrow();
});
