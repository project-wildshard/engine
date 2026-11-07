// oxlint-disable-next-line import/no-nodejs-modules -- This fixture owns isolated compiler-cache files.
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve only repository scratch.
import { resolve } from 'node:path';
import { expect, test, vi } from 'vitest';
import { build } from 'vite';
import { memoAssemblyScript } from '../src/sharddev/bake/assemblyscriptMemo';
import * as identity from '../src/sharddev/projectCompilerIdentity';
import { compileScript } from '../src/sharddev/bake/compileScript';
import { compileScriptV2 } from '../src/sharddev/bake/compileScriptV2';
import type { AssemblyScriptMemo } from '../src/sharddev/bake/assemblyscriptMemoPort';
import * as finite from '../src/sharddev/bake/v2Finite';
import * as fuel from '../src/sharddev/bake/v2Fuel';
import * as admission from '@wildshard/format/scriptAdmissionV2';
import { encodeCanonicalJson, hashImmutableBytes } from '../src/shared/host/immutable';

async function isolated(run: (root: string) => Promise<void>): Promise<void> {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/as-raw-memo-'));
  const previous = process.env['WILDSHARD_AS_RAW_CACHE'];
  process.env['WILDSHARD_AS_RAW_CACHE'] = root;
  try { await run(root); }
  finally {
    if (previous === undefined) delete process.env['WILDSHARD_AS_RAW_CACHE'];
    else process.env['WILDSHARD_AS_RAW_CACHE'] = previous;
    vi.restoreAllMocks(); rmSync(root, { recursive: true, force: true });
  }
}

test('raw memo keys every source, compiler flag and installed compiler identity while owning returned bytes', () => isolated(async () => {
  const compiler = vi.spyOn(identity, 'rawAssemblyScriptCompilerIdentity').mockResolvedValue('a'.repeat(64));
  const original = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const generate = vi.fn(() => Promise.resolve(original));
  const args = ['main.ts', '-O3'], sources = new Map([['main.ts', 'export function value():i32{return 1;}'], ['part.ts', 'export const part=1;']]);
  const cold = await memoAssemblyScript(args, sources, generate);
  const hit = await memoAssemblyScript(args, new Map(sources), generate);
  expect(cold).toEqual(original); expect(hit).toEqual(original); expect(hit).not.toBe(cold);
  hit.fill(0); expect(await memoAssemblyScript(args, sources, generate)).toEqual(original);
  expect(generate).toHaveBeenCalledTimes(1);
  await memoAssemblyScript([...args, '--memoryBase', '1024'], sources, generate);
  await memoAssemblyScript(args, new Map([...sources, ['part.ts', 'export const part=2;']]), generate);
  await memoAssemblyScript(args, new Map([...sources, ['main.ts', 'export function value():i32{return 2;}']]), generate);
  compiler.mockResolvedValue('b'.repeat(64)); await memoAssemblyScript(args, sources, generate);
  expect(generate).toHaveBeenCalledTimes(5);
}));

test('raw memo repairs damaged storage and retains original compiler errors without caching them', () => isolated(async root => {
  vi.spyOn(identity, 'rawAssemblyScriptCompilerIdentity').mockResolvedValue('a'.repeat(64));
  const original = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
  const generate = vi.fn(() => Promise.resolve(original)), sources = new Map([['main.ts', 'source']]);
  await memoAssemblyScript([], sources, generate);
  for (const extension of ['.wasm', '.json']) {
    const name = readdirSync(root).find(file => file.endsWith(extension));
    if (name === undefined) throw new Error('Missing raw compiler memo');
    writeFileSync(resolve(root, name), 'damaged');
    expect(await memoAssemblyScript([], sources, generate)).toEqual(original);
  }
  expect(generate).toHaveBeenCalledTimes(3);
  const failure = vi.fn((): Promise<Uint8Array> => Promise.reject(new Error('actual compile failed')));
  for (let i = 0; i < 2; i++) await expect(memoAssemblyScript(['different'], sources, failure)).rejects.toThrow('actual compile failed');
  expect(failure).toHaveBeenCalledTimes(2);
  const blocker = resolve(root, 'not-a-directory'); writeFileSync(blocker, 'file');
  process.env['WILDSHARD_AS_RAW_CACHE'] = blocker;
  expect(await memoAssemblyScript([], sources, generate)).toEqual(original);
}));

const v2Source = `export function ws_abi():i32{return 2;} export function ws_io():i32{return 0;}
export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return 0;}
export function ws_step(tick:i32,fuel:i32):i32{store<i32>(2048,tick);return tick;}`;

test('native cold and raw-hit compilers preserve full final Wasm and run every v2 executable pass again', () => isolated(async () => {
  let generated = 0;
  const memo: AssemblyScriptMemo = (args, sources, generate) => memoAssemblyScript(args, sources, () => {
    generated++; return generate();
  });
  const reference = await compileScriptV2(v2Source);
  const finitePass = vi.spyOn(finite, 'instrumentV2Finite'), fuelPass = vi.spyOn(fuel, 'instrumentV2Fuel');
  const admitted = vi.spyOn(admission, 'admitScriptV2');
  const cold = await compileScriptV2(v2Source, { compileMemo: memo });
  expect(generated).toBe(2);
  expect(await compileScriptV2(v2Source, { compileMemo: memo })).toEqual(reference);
  expect(cold).toEqual(reference); expect(generated).toBe(2);
  expect(finitePass).toHaveBeenCalledTimes(2); expect(fuelPass).toHaveBeenCalledTimes(2); expect(admitted).toHaveBeenCalledTimes(2);
  await expect(compileScriptV2(v2Source, { compileMemo: memo, compilerRevision: 2 })).rejects.toThrow('compiler revision');
  await expect(compileScriptV2(v2Source, { compileMemo: memo, ioBytes: 65537 })).rejects.toThrow('IO does not fit');
  expect(generated).toBe(2);
  const legacySource = 'export function value():i32{return 42;}', legacyReference = await compileScript(legacySource, { abi: 1 });
  const legacy = await compileScript(legacySource, { abi: 1, compileMemo: memo });
  const afterCold = generated;
  expect(await compileScript(legacySource, { abi: 1, compileMemo: memo })).toEqual(legacyReference);
  expect(legacy).toEqual(legacyReference); expect(generated).toBe(afterCold);
  await expect(compileScript(legacySource, { abi: 1, maximumPages: 5, compileMemo: memo })).rejects.toThrow('maximumPages');
}));

test('pure compiler bundles do not acquire host memo or filesystem imports', async () => {
  const built = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
    lib: { entry: [resolve('src/sharddev/bake/compileScript.ts'), resolve('src/sharddev/bake/compileScriptV2.ts')], formats: ['es'] },
    rolldownOptions: { external: [/^node:/u, 'binaryen', /^assemblyscript\//u] } } });
  const result = Array.isArray(built) ? built[0] : built;
  if (result === undefined || !('output' in result)) throw new Error('Missing pure compiler bundle');
  const chunks = result.output.filter(row => row.type === 'chunk');
  expect(chunks.length).toBeGreaterThan(0);
  for (const chunk of chunks) {
    expect([...chunk.imports, ...chunk.dynamicImports].some(name => /^(?:node:)?(?:fs|module)(?:\/|$)/u.test(name))).toBe(false);
    expect(Object.keys(chunk.modules).some(name => name.endsWith('/bake/assemblyscriptMemo.ts'))).toBe(false);
  }
});


test('only an exact verified old full-compiler key migrates into the raw key and owns its bytes',()=>isolated(async root=>{
  vi.spyOn(identity,'projectCompilerIdentity').mockResolvedValue('a'.repeat(64));
  vi.spyOn(identity,'rawAssemblyScriptCompilerIdentity').mockResolvedValue('b'.repeat(64));
  const args=['main.ts','-O3'],sources=new Map([['main.ts','source']]);
  const key=hashImmutableBytes(new TextEncoder().encode(encodeCanonicalJson({version:1,compiler:'a'.repeat(64),node:process.version,platform:process.platform,arch:process.arch,args,sources:[...sources]})));
  const bytes=new Uint8Array([0,97,115,109,1,0,0,0]);
  writeFileSync(resolve(root,`${key}.wasm`),bytes);
  writeFileSync(resolve(root,`${key}.json`),JSON.stringify({key,hash:hashImmutableBytes(bytes),bytes:bytes.length}));
  const generate=vi.fn(()=>Promise.resolve(bytes));
  const migrated=await memoAssemblyScript(args,sources,generate);
  expect(migrated).toEqual(bytes);expect(generate).not.toHaveBeenCalled();
  expect(readdirSync(root).filter(name=>name.endsWith('.wasm'))).toHaveLength(2);
  migrated.fill(0);
  // A later decision-builder identity change still hits the validated raw entry.
  vi.mocked(identity.projectCompilerIdentity).mockResolvedValue('c'.repeat(64));
  expect(await memoAssemblyScript(args,sources,generate)).toEqual(bytes);
  expect(generate).not.toHaveBeenCalled();
  await memoAssemblyScript([...args,'--memoryBase','1024'],sources,generate);
  expect(generate).toHaveBeenCalledTimes(1);
}));


test('a raw hit cannot bypass the original full compiler identity refusal',()=>isolated(async()=>{
  const full=vi.spyOn(identity,'projectCompilerIdentity').mockResolvedValue('a'.repeat(64));
  vi.spyOn(identity,'rawAssemblyScriptCompilerIdentity').mockResolvedValue('b'.repeat(64));
  const bytes=new Uint8Array([0,97,115,109,1,0,0,0]);
  const generate=vi.fn(()=>Promise.resolve(bytes)),sources=new Map([['main.ts','source']]);
  expect(await memoAssemblyScript([],sources,generate)).toEqual(bytes);
  full.mockRejectedValue(new Error('Original full compiler input refused'));
  await expect(memoAssemblyScript([],sources,generate)).rejects.toThrow('Original full compiler input refused');
  expect(generate).toHaveBeenCalledTimes(1);
}));
