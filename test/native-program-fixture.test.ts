// oxlint-disable-next-line import/no-nodejs-modules -- Own isolated source and cache fixtures; never alter real producer files.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine every synthetic compiler and cache beneath tmp.
import { resolve } from 'node:path';
import { afterEach, expect, test } from 'vitest';
import { nativeProgramFixture } from './fixtures/native-program';

const owned: string[] = [];
afterEach(() => { for (const path of owned.splice(0)) rmSync(path, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(resolve('tmp/native-program-')); owned.push(root);
  mkdirSync(resolve(root, 'source')); mkdirSync(resolve(root, 'scripts'));
  writeFileSync(resolve(root, 'source/value.txt'), 'one');
  writeFileSync(resolve(root, 'scripts/bake-loader.mjs'), '');
  writeFileSync(resolve(root, 'compiler.mjs'), `
    import fs from 'node:fs';
    const calls=fs.existsSync('calls')?Number(fs.readFileSync('calls','utf8')):0;
    fs.writeFileSync('calls',String(calls+1));
    process.stdout.write(JSON.stringify({value:fs.readFileSync('source/value.txt','utf8'),files:fs.readdirSync('source').sort()}));
  `);
  const spec = { root, cacheDir: resolve(root, 'cache'), id: 'program', script: 'compiler.mjs', inputs: ['source', 'scripts/bake-loader.mjs'] };
  return { root, spec, calls: () => Number(readFileSync(resolve(root, 'calls'), 'utf8')) };
}

test('separate and concurrent loans execute one actual compiler, without caching test outcomes', async () => {
  const { spec, calls } = fixture();
  const [first, second] = await Promise.all([nativeProgramFixture(spec), nativeProgramFixture(spec)]);
  expect(second).toBe(first); expect(calls()).toBe(1);
  expect(await nativeProgramFixture(spec)).toBe(first); expect(calls()).toBe(1);
  expect(JSON.parse(first)).toEqual({ value: 'one', files: ['value.txt'] });
});

test('the original transform-types host option stays in the construction key', async () => {
  const { spec, calls } = fixture();
  const plain = await nativeProgramFixture(spec);
  const transformed = await nativeProgramFixture({ ...spec, transformTypes: true });
  expect(transformed).toBe(plain);
  expect(calls()).toBe(2);
  expect(await nativeProgramFixture({ ...spec, transformTypes: true })).toBe(transformed);
  expect(calls()).toBe(2);
});

test('the simulation loader keeps its command and loader bytes in the construction fence', async () => {
  const { root, spec, calls } = fixture();
  const loader = resolve(root, 'scripts/sim-node-loader.mjs');
  writeFileSync(loader, '');
  mkdirSync(resolve(root, 'lint'));
  writeFileSync(resolve(root, 'lint/sim-schema-leaves.json'), '{}');
  const original = await nativeProgramFixture(spec);
  const simulation = { ...spec, loader: 'simulation' as const };
  expect(await nativeProgramFixture(simulation)).toBe(original);
  expect(calls()).toBe(2);
  expect(await nativeProgramFixture(simulation)).toBe(original);
  expect(calls()).toBe(2);
  writeFileSync(loader, '// changed simulation loader\n');
  expect(await nativeProgramFixture(simulation)).toBe(original);
  expect(calls()).toBe(3);
  writeFileSync(resolve(root, 'scripts/bake-loader.mjs'), '// original loader remains fenced\n');
  expect(await nativeProgramFixture(simulation)).toBe(original);
  expect(calls()).toBe(4);
  writeFileSync(resolve(root, 'lint/sim-schema-leaves.json'), '{"leaf":true}');
  expect(await nativeProgramFixture(simulation)).toBe(original);
  expect(calls()).toBe(5);
});

test('changed source bytes, new inventory and changed compiler invalidate construction', async () => {
  const { root, spec, calls } = fixture();
  const first = await nativeProgramFixture(spec);
  const file = resolve(root, 'source/value.txt'), stamp = statSync(file);
  writeFileSync(file, 'two'); utimesSync(file, stamp.atime, stamp.mtime);
  const second = await nativeProgramFixture(spec);
  expect(second).not.toBe(first); expect(calls()).toBe(2);
  writeFileSync(resolve(root, 'source/extra.txt'), 'new input');
  expect(await nativeProgramFixture(spec)).not.toBe(second); expect(calls()).toBe(3);
  writeFileSync(resolve(root, 'compiler.mjs'), `${readFileSync(resolve(root, 'compiler.mjs'), 'utf8')}\n// compiler revision\n`);
  await nativeProgramFixture(spec); expect(calls()).toBe(4);
});

test('same-length damaged cached bytes rebuild rather than inherit an old outcome', async () => {
  const { root, spec, calls } = fixture();
  const before = await nativeProgramFixture(spec);
  const entries = readdirSync(resolve(root, 'cache/fixture-program')).filter(name => /^[a-f0-9]{64}$/u.test(name));
  expect(entries).toHaveLength(1);
  const entry = entries[0]; if (entry === undefined) throw new Error('Missing native entry');
  const file = resolve(root, 'cache/fixture-program', entry, 'fixture.json'), stamp = statSync(file);
  writeFileSync(file, before.replace('one', 'BAD')); utimesSync(file, stamp.atime, stamp.mtime);
  expect(await nativeProgramFixture(spec)).toBe(before); expect(calls()).toBe(2);
  const readers = resolve(root, 'cache/fixture-program', `${entry}.readers`);
  expect(existsSync(readers) ? readdirSync(readers) : []).toEqual([]);
});

test('a shared cache never lends a construction from another working directory', async () => {
  const first = fixture(), second = fixture();
  for (const { root } of [first, second]) {
    const script = resolve(root, 'compiler.mjs');
    writeFileSync(script, readFileSync(script, 'utf8').replace('value:fs.readFileSync', 'cwd:process.cwd(),value:fs.readFileSync'));
  }
  const a: unknown = JSON.parse(await nativeProgramFixture(first.spec));
  const b: unknown = JSON.parse(await nativeProgramFixture({ ...second.spec, cacheDir: first.spec.cacheDir }));
  expect(a).toEqual({ cwd: first.root, value: 'one', files: ['value.txt'] });
  expect(b).toEqual({ cwd: second.root, value: 'one', files: ['value.txt'] });
  expect(first.calls()).toBe(1); expect(second.calls()).toBe(1);
});

test('the mandatory loader is an input even when the caller names only its data', async () => {
  const { root, spec, calls } = fixture(), dataOnly = { ...spec, inputs: ['source'] };
  const before = await nativeProgramFixture(dataOnly);
  writeFileSync(resolve(root, 'scripts/bake-loader.mjs'), '// loader revision\n');
  expect(await nativeProgramFixture(dataOnly)).toBe(before); expect(calls()).toBe(2);
});

test('a compiler changing its input inventory cannot publish a ready entry', async () => {
  const { root, spec } = fixture(), script = resolve(root, 'compiler.mjs');
  writeFileSync(script, readFileSync(script, 'utf8').replace('process.stdout.write', "fs.writeFileSync('source/late.txt','late');process.stdout.write"));
  await expect(nativeProgramFixture(spec)).rejects.toThrow('Native compiler input inventory changed');
  expect(readdirSync(resolve(root, 'cache/fixture-program')).filter(name => /^[a-f0-9]{64}$/u.test(name))).toEqual([]);
});
