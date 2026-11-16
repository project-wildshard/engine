import {registeredJsonSchema} from '../src/shared/host/formatJsonSchema';
import { expect, test, vi } from 'vitest';
import { build } from 'vite';
import { emptyShardfile } from '../src/shared/host/author';
import { encodeCanonicalJson, hashImmutableBytes } from '../src/shared/host/immutable';
import { outputSectionPayloads } from '@wildshard/format/outputFields';
import type { resolveOutputDescriptor } from '../src/shared/game/shardfile/outputDescriptor';
import type { admitFolder, FolderOptions } from '../src/client/game/shardfile/folder';
import type { createShardFolder } from '../src/shared/game/shardfile/shardFolder';
import type { readCheckedOutputIndex } from '../src/shared/game/shardfile/outputIndexChecks';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute and remove one real browser build as an owned temporary module.
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- Keep the temporary browser module under the repository scratch root.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Native import evaluates the bundled browser entry without a browser or eval shim.
import { pathToFileURL } from 'node:url';

function resolverModule(input: unknown): input is { resolveOutputDescriptor: typeof resolveOutputDescriptor; admitFolder: typeof admitFolder;
  createShardFolder: typeof createShardFolder; readCheckedOutputIndex: typeof readCheckedOutputIndex } {
  return typeof input === 'object' && input !== null && 'resolveOutputDescriptor' in input && typeof input.resolveOutputDescriptor === 'function'
    && 'admitFolder' in input && typeof input.admitFolder === 'function'
    && 'createShardFolder' in input && typeof input.createShardFolder === 'function'
    && 'readCheckedOutputIndex' in input && typeof input.readCheckedOutputIndex === 'function';
}

test('browser products need a build proof and bundle no checked host intake', async () => {
  const encode = (input: unknown): Uint8Array => new TextEncoder().encode(encodeCanonicalJson(input));
  const source = emptyShardfile({ slug: 'browser-descriptor', name: 'Browser', author: 'Test', revision: 1, seed: 1 });
  const values = outputSectionPayloads(source), wires = new Map([...values].map(([name, value]) => [`sections/${name}.json`, encode(value)]));
  const index = { format: 'wildshard.shardfile', formatVersion: 2, sdk: '0.2', version: source.version, identity: source.identity,
    requires: source.requires, build: { sourceHash: hashImmutableBytes(encode(source)), validator: 'browser-boundary' },
    admission: { budgets: source.budgets, serverBudget: source.serverBudget, authorCaps: source.authorCaps, critical: source.critical, library: source.library },
    sections: [...values].map(([name]) => {
      const path = `sections/${name}.json`, bytes = wires.get(path); if (bytes === undefined) throw new Error('Missing section');
      return { name, path, bytes: bytes.length, hash: hashImmutableBytes(bytes), schema: `wildshard:${name}@1` };
    }), schemas: [], files: [], runtime: null };
  const entry = new URL('../descriptor-check-boundary', import.meta.url).pathname;
  const folderEntry = new URL('../src/client/game/shardfile/folder.ts', import.meta.url).pathname;
  const metadataEntry = new URL('../src/shared/game/shardfile/outputIndexChecks.ts', import.meta.url).pathname;
  const result = await build({ configFile: false, publicDir: false, logLevel: 'silent',
    define: { __SHARDFILE_VALIDATOR__: JSON.stringify('browser-boundary'), __SHARDFILE_VERDICTS__: JSON.stringify([{ revision: 'browser-boundary',
      sourceHash: index.build.sourceHash, indexHash: hashImmutableBytes(encode(index)), worst: { playing: 0, loading: 0, accounted: 0, location: [0, 0] } }]) },
    plugins: [{ name: 'descriptor-check-boundary', resolveId(id) { return id === entry ? '\0descriptor-check-boundary' : null; },
      load(id) { return id === '\0descriptor-check-boundary' ? `export {resolveOutputDescriptor} from '@wildshard/engine/game/shardfile/outputDescriptor';
        export {admitFolder} from ${JSON.stringify(folderEntry)};
        export {readCheckedOutputIndex} from ${JSON.stringify(metadataEntry)};
        export {createShardFolder} from '@wildshard/engine/game/shardfile/shardFolder';` : null; } }],
    build: { write: false, minify: false, lib: { entry, formats: ['es'] }, rolldownOptions: { output: { codeSplitting: false } } } });
  const built = Array.isArray(result) ? result[0] : result;
  if (built === undefined || !('output' in built)) throw new Error('Missing descriptor bundle');
  const chunks = built.output.filter(row => row.type === 'chunk'), modules = chunks.flatMap(chunk => Object.keys(chunk.modules));
  expect(chunks).toHaveLength(1);
  for (const name of ['outputIndex', 'shardSchema', 'product', 'assetAdmission', 'scriptAdmission']) {
    expect(modules.some(id => id.endsWith(`/src/format/${name}.ts`)), name).toBe(false);
  }
  expect(modules.some(id => id.endsWith('/shardfile/customSchema.ts'))).toBe(false);
  expect(modules.some(id => /(?:^|\/)node_modules\/ajv\//u.test(id.replaceAll('\\', '/')))).toBe(false);
  const code = chunks.map(chunk => chunk.code).join('\n');
  await mkdir('tmp', { recursive: true });
  const dir = await mkdtemp(resolve('tmp/browser-descriptor-')), file = resolve(dir, 'reader.mjs');
  let loaded: unknown;
  try { await writeFile(file, code); loaded = await import(pathToFileURL(file).href); }
  finally { await rm(dir, { recursive: true, force: true }); }
  if (!resolverModule(loaded)) throw new Error('Missing browser resolver');
  const read = vi.fn((path: string) => {
    const bytes = wires.get(path); if (bytes === undefined) throw new Error('Missing section');
    return Promise.resolve(Uint8Array.from(bytes));
  }), hash = vi.fn((bytes: Uint8Array) => Promise.resolve(hashImmutableBytes(bytes)));
  const nativeRead=async(path:string,size:number):Promise<Uint8Array>=>{
    const bytes=await read(path);if(bytes.length!==size)throw new Error('Emitted section size mismatch');return bytes;
  };
  const reader = { offline: false, firstParty: true, read, hash,
    built:{indexHash:hashImmutableBytes(encode(index)),read:nativeRead}};
  expect(await loaded.resolveOutputDescriptor(index, reader)).toEqual(source);
  expect(read).toHaveBeenCalledTimes(index.sections.length);expect(hash).not.toHaveBeenCalled();
  read.mockClear(); hash.mockClear();
  const unprovedReader={offline:false,firstParty:true,read,hash};
  // Authored fields and a matching receipt do not grant the native build capability.
  await expect(loaded.resolveOutputDescriptor({ ...index, identity: { ...index.identity, revision: 2 } }, unprovedReader))
    .rejects.toThrow('build-owned reader');
  expect(read).not.toHaveBeenCalled();
  await expect(loaded.resolveOutputDescriptor(index, unprovedReader)).rejects.toThrow('build-owned reader');
  await expect(loaded.resolveOutputDescriptor(index, { ...reader, firstParty: false })).rejects.toThrow('build-owned reader');
  expect(read).not.toHaveBeenCalled();
  const fetch = vi.fn((url: string) => {
    const bytes = wires.get(url.slice('https://fixture.test/'.length));
    return Promise.resolve(bytes === undefined ? new Response(null, { status: 404 }) : new Response(Uint8Array.from(bytes)));
  });
  const options: FolderOptions = { base: 'https://fixture.test/', offline: false, firstParty: true, hash, fetch,
    firstPartyRead:async(url,size)=>{
      const response=await fetch(url);if(!response.ok)throw new Error('Missing emitted fixture file');
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(size!==undefined&&bytes.length!==size)throw new Error('Emitted fixture size mismatch');return bytes;
    }};
  const admitted = await loaded.admitFolder(index, options);
  expect(admitted.source).toEqual(source);
  expect((await loaded.admitFolder(admitted.source, options)).source).toBe(admitted.source);
  fetch.mockClear();
  admitted.source.identity.name = 'Changed exposed source';
  const unprovedOptions:FolderOptions={base:options.base,offline:false,firstParty:true,hash,fetch};
  expect(()=>loaded.admitFolder(admitted.source, unprovedOptions)).toThrow('build-owned reader');
  expect(fetch).not.toHaveBeenCalled();
  expect(()=>loaded.admitFolder(structuredClone(source), unprovedOptions)).toThrow('build-owned reader');
  expect(fetch).not.toHaveBeenCalled();
  expect(()=>loaded.admitFolder(index, { ...options, firstParty: false })).toThrow('build-owned reader');
  expect(fetch).not.toHaveBeenCalled();
  await expect(loaded.readCheckedOutputIndex(index)).rejects.toThrow('server validation');
  const value = {rows:{},urls:{}}, jsonBytes = encode(value), jsonHash = hashImmutableBytes(jsonBytes);
  const jsonInput = { slug: source.identity.slug, revision: 1, shardfile: source, sections: values,
    files: new Map([['world/sources/bakes.json', { hash: jsonHash, url: '/value.json', jsonSchema: registeredJsonSchema('world/sources/bakes.json') }]]),
    read: vi.fn(() => Promise.resolve(jsonBytes)) };
  expect(await loaded.createShardFolder({ ...jsonInput, builtJson: true }).json('world/sources/bakes.json')).toEqual(value);
  jsonInput.read.mockClear();
  await expect(loaded.createShardFolder(jsonInput).json('world/sources/bakes.json')).rejects.toThrow('server validation');
  expect(jsonInput.read).not.toHaveBeenCalled();
  await expect(loaded.createShardFolder({ ...jsonInput, builtJson: true, read: () => Promise.resolve(new TextEncoder().encode('{broken')) }).json('world/sources/bakes.json')).rejects.toThrow();
  await expect(loaded.createShardFolder({ ...jsonInput, builtJson: true, read: () => Promise.resolve(new Uint8Array([255])) }).json('world/sources/bakes.json')).rejects.toThrow();
  const first = index.sections[0]; if (first === undefined) throw new Error('Missing section');
  wires.set(first.path, new Uint8Array(first.bytes));
  await expect(loaded.resolveOutputDescriptor(index, reader)).rejects.toMatchObject({name:'SyntaxError'});
  wires.set(first.path,new Uint8Array(first.bytes-1));
  await expect(loaded.resolveOutputDescriptor(index, reader)).rejects.toThrow('Emitted section size mismatch');
  expect(hash).not.toHaveBeenCalled();
});
