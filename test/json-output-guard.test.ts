// oxlint-disable-next-line import/no-nodejs-modules -- Drive the real JSON producer in tiny owned fixtures.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own fixture inputs and assert failed writers publish nothing.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Fixture paths remain under ignored tmp.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the real SDK driver executable.
import { fileURLToPath } from 'node:url';
// oxlint-disable-next-line import/no-nodejs-modules -- Use the same Node executable as the parent test.
import { execPath } from 'node:process';
// oxlint-disable-next-line import/no-nodejs-modules -- Native VM values exercise the serializer's cross-realm byte boundary.
import { runInNewContext } from 'node:vm';
import { expect, test } from 'vitest';
import { jsonOutputGuard, jsonOutputPolicy, assertJsonRows } from '../scripts/json-output-guard.mjs';
import { byteWriter, jsonBytes } from '../scripts/bake-output.mjs';

const payload = 'a'.repeat(1024);
const output = 'src/shards/example/data/output.json';
const entry = 'src/shards/example/generators/bake-example.mjs';
const driver = fileURLToPath(new URL('../src/sharddev/bake/json.mjs', import.meta.url));
const put = (root: string, name: string, text: string): void => {
  const target = resolve(root, name); mkdirSync(resolve(target, '..'), { recursive: true }); writeFileSync(target, text);
};
async function fixture(run: (root: string) => void | Promise<void>): Promise<void> {
  mkdirSync('tmp', { recursive: true });
  const root = mkdtempSync(resolve('tmp/json-writer-test-'));
  try { await run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
const debt = (root: string, files: Record<string, { base64Chars: number; dataUris: number }>): void => {
  put(root, 'lint/no-binary-json.json', JSON.stringify({ schema: 'no-binary-json/1', source: 'a'.repeat(40), files }));
};

test('an isolated policy retains only declared allowances and still validates the full source',()=>fixture(root=>{
  const other='src/shards/other/data/output.json';
  debt(root,{[output]:{base64Chars:1024,dataUris:0},[other]:{base64Chars:2048,dataUris:0}});
  const projected=jsonOutputPolicy(root,[output]);
  if(projected===undefined)throw new Error('Expected the existing policy');
  expect(JSON.parse(projected)).toEqual({schema:'no-binary-json/1',source:'a'.repeat(40),files:{[output]:{base64Chars:1024,dataUris:0}}});
  put(root,'lint/no-binary-json.json',projected);
  const guard=jsonOutputGuard(root);
  expect(()=>guard(output,JSON.stringify({text:payload}))).not.toThrow();
  expect(()=>guard(other,JSON.stringify({text:payload}))).toThrow('BINARY-JSON');
  debt(root,{[output]:{base64Chars:1024,dataUris:0},[other]:{base64Chars:-1,dataUris:0}});
  expect(()=>jsonOutputPolicy(root,[output])).toThrow('invalid allowance');
}));

 test('shared JSON serialization refuses byte values before their numeric disguise', () => {
  for (const value of [new Uint8Array([1, 2]), new Float32Array([1]), new ArrayBuffer(2), new SharedArrayBuffer(2), { type: 'Buffer', data: [1, 2] }]) {
    expect(() => assertJsonRows({ nested: [value] })).toThrow('byte values');
    expect(() => jsonBytes({ nested: [value] })).toThrow('byte values');
  }
  expect(JSON.parse(jsonBytes({ position: [1, 2, 3], source: 'rows' }).toString())).toEqual({ position: [1, 2, 3], source: 'rows' });
});

test('shared JSON serialization refuses foreign native buffers before publishing an output', () => fixture(root => {
  const writer = byteWriter(false, 'foreign-byte-fixture', root);
  const target = resolve(root, output);
  for (const source of ['new ArrayBuffer(3)', 'new SharedArrayBuffer(3)',
    'new Uint8Array([1,2,3])', 'new Uint8ClampedArray([1,2,3])',
    'new Float64Array([1,2,3])', 'new DataView(new ArrayBuffer(3))']) {
    const value: unknown = runInNewContext(source);
    expect(() => assertJsonRows({ nested: [value] })).toThrow('byte values');
    expect(() => writer.put(target, jsonBytes({ nested: [value] }))).toThrow('byte values');
    expect(existsSync(target)).toBe(false);
  }
  const rows: unknown = runInNewContext('({position:[1,2,3],label:"authored rows"})');
  writer.put(target, jsonBytes(rows));
  expect(readFileSync(target, 'utf8')).toBe('{\n  "position": [\n    1,\n    2,\n    3\n  ],\n  "label": "authored rows"\n}\n');
}));

test('shared writer admits exact existing debt, refuses new paths and never skips checking unchanged bytes', () => fixture(root => {
  debt(root, { [output]: { base64Chars: 1024, dataUris: 0 } });
  const writer = byteWriter(false, 'fixture', root), bytes = jsonBytes({ text: payload });
  writer.put(resolve(root, output), bytes);
  expect(readFileSync(resolve(root, output))).toEqual(bytes);
  const other = resolve(root, 'public/assets/example/new.json');
  put(root, 'public/assets/example/new.json', bytes.toString());
  expect(() => writer.put(other, bytes)).toThrow('BINARY-JSON');
  expect(() => writer.put(resolve(root, output), jsonBytes({ text: `${payload}a` }))).toThrow('BINARY-JSON');
  expect(() => writer.put(other, jsonBytes({ uri: 'data:application/octet-stream,AA' }))).toThrow('BINARY-JSON');
  writer.put(resolve(root, 'public/assets/example/new.bin'), new Uint8Array([0, 1, 255]));
  expect([...readFileSync(resolve(root, 'public/assets/example/new.bin'))]).toEqual([0, 1, 255]);
}));

test('SDK JSON recipes refuse encoded and raw bytes before creating an output', () => fixture(root => {
  for (const expression of ["{text:'a'.repeat(1024)}", "{uri:'data:image/png;base64,AA=='}", '{bytes:new Uint8Array([1,2])}']) {
    put(root, entry, `export function make(){return ${expression}}`);
    expect(() => execFileSync(execPath, [driver, entry, 'make', output], { cwd: root, stdio: 'pipe' })).toThrow();
    expect(existsSync(resolve(root, output))).toBe(false);
  }
  put(root, entry, 'export function make(){return {rows:[1,2,3]}}');
  execFileSync(execPath, [driver, entry, 'make', output], { cwd: root, stdio: 'pipe' });
  expect(JSON.parse(readFileSync(resolve(root, output), 'utf8'))).toEqual({ rows: [1, 2, 3] });
}));

test.each(['directory', 'dangling', 'loop', 'source'])('SDK JSON path admission refuses %s links', kind => fixture(root => {
  const source = 'export function make(){return {rows:[1,2,3]}}';
  if (kind === 'source') {
    put(root, 'src/shards/example/generators/real.mjs', source);
    symlinkSync('real.mjs', resolve(root, entry));
  } else {
    put(root, entry, source);
    mkdirSync(resolve(root, 'src/shards/example/data'), { recursive: true });
    if (kind === 'directory') {
      mkdirSync(resolve(root, 'real-data'));
      symlinkSync(resolve(root, 'real-data'), resolve(root, 'src/shards/example/data/linked'), 'dir');
    } else symlinkSync(kind === 'loop' ? 'output.json' : resolve(root, 'absent.json'), resolve(root, output));
  }
  const target = kind === 'directory' ? 'src/shards/example/data/linked/output.json' : output;
  expect(() => execFileSync(execPath, [driver, entry, 'make', target], { cwd: root, stdio: 'pipe' })).toThrow('generate-json: symlink refused');
  expect(existsSync(resolve(root, 'real-data/output.json'))).toBe(false);
  expect(existsSync(resolve(root, 'absent.json'))).toBe(false);
  expect(existsSync(resolve(root, target))).toBe(false);
}));

test('SDK multi-file admission checks all JSON before writing any binary sibling', () => fixture(root => {
  put(root, entry, `export function make(){return new Map([['data/ok.bin',new Uint8Array([1,2])],['data/bad.json',new TextEncoder().encode(JSON.stringify({text:'a'.repeat(1024)}))]])}`);
  expect(() => execFileSync(execPath, [driver, entry, 'make', 'src/shards/example', '--files'], { cwd: root, stdio: 'pipe' })).toThrow();
  expect(existsSync(resolve(root, 'src/shards/example/data/ok.bin'))).toBe(false);
  expect(existsSync(resolve(root, 'src/shards/example/data/bad.json'))).toBe(false);
}));

test('SDK explicit byte products stay binary and cannot disguise JSON at a .json path', () => fixture(root => {
  put(root, entry, 'export function make(){return new Uint8Array([0,1,255])}');
  const bin = 'src/shards/example/data/output.bin';
  execFileSync(execPath, [driver, entry, 'make', bin, '--bytes'], { cwd: root, stdio: 'pipe' });
  expect([...readFileSync(resolve(root, bin))]).toEqual([0, 1, 255]);
  put(root, entry, "export function make(){return new TextEncoder().encode(JSON.stringify({text:'a'.repeat(1024)}))}");
  expect(() => execFileSync(execPath, [driver, entry, 'make', output, '--bytes'], { cwd: root, stdio: 'pipe' })).toThrow();
  expect(existsSync(resolve(root, output))).toBe(false);
}));
