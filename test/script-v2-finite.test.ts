import { expect, test } from 'vitest';
import binaryen from 'binaryen';
import { instrumentV2Finite, inspectV2Finite } from '../src/sharddev/bake/v2Finite';
import { compileScript } from '../src/sharddev/bake/compileScript';
import { admitScript } from '@wildshard/format/scriptAdmission';
import { sha256 } from '../src/shared/game/plugin/moduleHash';
import { scriptSource } from '../src/sharddev/test/scriptSource';

function bytes(source: string): Uint8Array {
  const module = binaryen.parseText(source);
  try { return module.emitBinary(); } finally { module.dispose(); }
}
const module = (body: string): string => `(module (import "env" "memory" (memory 1 1)) ${body})`;
const callable = (value: unknown): value is (...args: (number | bigint)[]) => unknown => typeof value === 'function';
async function fixture(source: string): Promise<{ call: (name: string, ...args: (number | bigint)[]) => unknown; memory: WebAssembly.Memory; bytes: Uint8Array }> {
  const result = instrumentV2Finite(bytes(module(source))), memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  const { instance } = await WebAssembly.instantiate(new Uint8Array(result), { env: { memory } });
  return { call: (name, ...args) => { const method = instance.exports[name]; if (!callable(method)) throw new Error('Missing fixture export'); return method(...args); }, memory, bytes: result };
}

test('v2 guards finite stores in Wasm, preserving both widths and signed zero without function imports', async () => {
  const f = await fixture(`(func (export "f32") (param f32) (f32.store (i32.const 0) (local.get 0)))
    (func (export "f64") (param f64) (f64.store (i32.const 8) (local.get 0)))`);
  expect(inspectV2Finite(f.bytes)).toEqual({ stores: 2, globals: 0, reinterprets: 0 });
  const native = await WebAssembly.compile(new Uint8Array(f.bytes));
  expect(WebAssembly.Module.imports(native)).toEqual([{ module: 'env', name: 'memory', kind: 'memory' }]);
  const view = new DataView(f.memory.buffer);
  for (const value of [-0,0,1.25,-3,3.4028234663852886e38]) {
    f.call('f32',value); expect(Object.is(view.getFloat32(0,true),Math.fround(value))).toBe(true);
    f.call('f64',value); expect(Object.is(view.getFloat64(8,true),value)).toBe(true);
  }
  for (const value of [Number.NaN,Infinity,-Infinity]) {
    expect(() => f.call('f32',value)).toThrow(WebAssembly.RuntimeError);
    expect(() => f.call('f64',value)).toThrow(WebAssembly.RuntimeError);
  }
  // A finite JS f64 may overflow when narrowed to f32 at the exported boundary.
  expect(() => f.call('f32',Number.MAX_VALUE)).toThrow(WebAssembly.RuntimeError);
  f.call('f64',Number.MAX_VALUE); expect(view.getFloat64(8,true)).toBe(Number.MAX_VALUE);
});

test('v2 checks arithmetic, float loads and mutable-global writes before publication', async () => {
  const f = await fixture(`(global $saved (mut f64) (f64.const 1))
    (func (export "overflow") (param f64) (f64.store (i32.const 0) (f64.mul (local.get 0) (f64.const 2))))
    (func (export "copy") (f64.store (i32.const 0) (f64.load (i32.const 8))))
    (func (export "set") (param f64) (global.set $saved (local.get 0)))
    (func (export "get") (result f64) (global.get $saved))`);
  expect(() => f.call('overflow',Number.MAX_VALUE)).toThrow(WebAssembly.RuntimeError);
  new DataView(f.memory.buffer).setFloat64(8,Number.NaN,true);
  expect(() => f.call('copy')).toThrow(WebAssembly.RuntimeError);
  f.call('set',4); expect(f.call('get')).toBe(4);
  expect(() => f.call('set',Infinity)).toThrow(WebAssembly.RuntimeError); expect(f.call('get')).toBe(4);
  expect(inspectV2Finite(f.bytes)).toEqual({ stores: 2, globals: 1, reinterprets: 0 });
});

test('v2 rejects nonfinite reinterpretation in both directions and widths', async () => {
  const f = await fixture(`(func (export "from32") (param i32) (result f32) (f32.reinterpret_i32 (local.get 0)))
    (func (export "from64") (param i64) (result f64) (f64.reinterpret_i64 (local.get 0)))
    (func (export "to32") (param f32) (result i32) (i32.reinterpret_f32 (local.get 0)))
    (func (export "to64") (param f64) (result i64) (i64.reinterpret_f64 (local.get 0)))`);
  expect(inspectV2Finite(f.bytes).reinterprets).toBe(4);
  expect(f.call('from32',0x3f800000)).toBe(1); expect(f.call('from64',0x3ff0000000000000n)).toBe(1);
  expect(f.call('to32',1)).toBe(0x3f800000); expect(f.call('to64',1)).toBe(0x3ff0000000000000n);
  for (const value of [0x7f800000,0x7fc00001,0xff800000]) expect(() => f.call('from32',value)).toThrow(WebAssembly.RuntimeError);
  for (const value of [0x7ff0000000000000n,0x7ff8000000000001n,0xfff0000000000000n]) expect(() => f.call('from64',value)).toThrow(WebAssembly.RuntimeError);
  for (const value of [Number.NaN,Infinity,-Infinity]) {
    expect(() => f.call('to32',value)).toThrow(WebAssembly.RuntimeError);
    expect(() => f.call('to64',value)).toThrow(WebAssembly.RuntimeError);
  }
});

test('v2 retains existing branch targets and isolates nested temporary values', async () => {
  const f = await fixture(`(func (export "branch") (param $choose i32)
    (f64.store (i32.const 0) (block $selected (result f64)
      (drop (br_if $selected (f64.const 2) (local.get $choose))) (f64.const 3))))
    (func (export "nested") (param $x f32)
      (f32.store (i32.const 16) (f32.reinterpret_i32 (i32.reinterpret_f32 (local.get $x)))))`);
  f.call('branch',1); expect(new DataView(f.memory.buffer).getFloat64(0,true)).toBe(2);
  f.call('branch',0); expect(new DataView(f.memory.buffer).getFloat64(0,true)).toBe(3);
  f.call('nested',1.5); expect(new DataView(f.memory.buffer).getFloat32(16,true)).toBe(1.5);
  expect(() => f.call('nested',Number.NaN)).toThrow(WebAssembly.RuntimeError);
});

const forged = (value: string, bound = '1.7976931348623157e+308', nan = '(f64.ne (local.get $tmp) (local.get $tmp))'): Uint8Array => bytes(module(`
  (func (export "forged") (param $escape i32) (local $tmp f64)
    (f64.store (i32.const 0) (block $guard (result f64)
      (local.set $tmp ${value})
      (if (i32.or ${nan} (f64.gt (f64.abs (local.get $tmp)) (f64.const ${bound}))) (then (unreachable)))
      (local.get $tmp))))`));

test('the build verifier refuses missing/weakened guards and branches that skip a finite check', async () => {
  expect(inspectV2Finite(forged('(f64.const 2)')).stores).toBe(1);
  expect(() => inspectV2Finite(bytes(module('(func (f64.store (i32.const 0) (f64.const nan)))')))).toThrow('finite input guard');
  expect(() => inspectV2Finite(forged('(f64.const inf)','inf'))).toThrow('finite input guard');
  expect(() => inspectV2Finite(forged('(f64.const nan)',undefined,'(i32.const 0)'))).toThrow('finite input guard');
  const bypass = '(block (result f64) (drop (br_if $guard (f64.const nan) (local.get $escape))) (f64.const 2))';
  const hostile = forged(bypass), memory = new WebAssembly.Memory({ initial: 1, maximum: 1 });
  const { instance } = await WebAssembly.instantiate(new Uint8Array(hostile), { env: { memory } });
  const escaped = instance.exports['forged']; if (!callable(escaped)) throw new Error('Missing attack fixture');
  escaped(1); expect(Number.isNaN(new DataView(memory.buffer).getFloat64(0,true))).toBe(true);
  // Binaryen may restructure an escaping expression, making its containing
  // guard noncanonical; either structural refusal must prevent admission.
  expect(() => inspectV2Finite(hostile)).toThrow(/finite.*guard/u);
});

test('the v2 build pass retains the SIMD refusal', () => {
  const simd = bytes(module('(func (result v128) (v128.const i32x4 0 0 0 0))'));
  expect(() => instrumentV2Finite(simd)).toThrow('Unsupported v2 features');
});

const v1Source = 'export function ws_abi():i32{return 1;} export function ws_init(lo:i32,hi:i32):void{} export function ws_io():i32{return 16384;} export function ws_handle():i32{store<f64>(16448,load<f64>(16448)+1);return 0;}';
test('v0/v1 compile and admission paths admit and compile repeatably', async () => {
  const old = await compileScript(scriptSource()), current = await compileScript(v1Source,{ abi: 1 });
  expect(admitScript(old).initialPages).toBe(1); expect(admitScript(current,1).initialPages).toBe(1);
  instrumentV2Finite(bytes(module('(func (param f64) (f64.store (i32.const 0) (local.get 0)))')));
  expect(sha256(await compileScript(v1Source,{ abi: 1 }))).toBe(sha256(current));
});


test('conditional reinterpret results retain explicit guards in both arms and widths',async()=>{
  const f=await fixture(`(func (export "branch32") (param $choose i32) (param $bits i32) (result f32)
    (if (result f32) (local.get $choose) (then (f32.reinterpret_i32 (local.get $bits)))
      (else (f32.neg (f32.reinterpret_i32 (local.get $bits))))))
    (func (export "branch64") (param $choose i32) (param $bits i64) (result f64)
    (if (result f64) (local.get $choose) (then (f64.reinterpret_i64 (local.get $bits)))
      (else (f64.neg (f64.reinterpret_i64 (local.get $bits))))))`);
  for(const [bits,value]of [[0,0],[0x80000000,-0],[0x3fa00000,1.25]] as const){
    expect(Object.is(f.call('branch32',1,bits),value)).toBe(true);expect(Object.is(f.call('branch32',0,bits),-value)).toBe(true);
  }
  for(const [bits,value]of [[0n,0],[0x8000000000000000n,-0],[0x3ff4000000000000n,1.25]] as const){
    expect(Object.is(f.call('branch64',1,bits),value)).toBe(true);expect(Object.is(f.call('branch64',0,bits),-value)).toBe(true);
  }
  for(const choose of [0,1]){
    for(const bits of [0x7f800000,0xff800000,0x7fc00001])expect(()=>f.call('branch32',choose,bits)).toThrow(WebAssembly.RuntimeError);
    for(const bits of [0x7ff0000000000000n,0xfff0000000000000n,0x7ff8000000000001n])expect(()=>f.call('branch64',choose,bits)).toThrow(WebAssembly.RuntimeError);
  }
  expect(inspectV2Finite(f.bytes).reinterprets).toBe(4);
});
