import { originalHeldMetadata } from './fixtures/nalati-held-original';
import { NALATI_RIDING_PROGRAMS } from './fixtures/nalati-riding';
import { expect, test, vi } from 'vitest';
import * as v from 'valibot';
import { Scope } from '../src/shared/engine/app/scope';
import { FixedMemory } from '../src/shared/engine/script/fixedMemory';
import { ScriptModuleV2, prepareScriptMemory, scriptMemoryCensus } from '../src/shared/engine/script/moduleV2';
import { ReturnProgram } from '../src/shared/game/population/returnProgram';
import { ReturnProgramSchema } from '@wildshard/format/namedJsonContracts';
import { Rng } from '../src/shared/engine/core/rng';
import { admission, lendNalatiTitan } from './fixtures/nalati-return-modules';
import { titanRawPrograms, titanPrograms, titanModuleBytes } from './fixtures/titanInlineWitness';

const held = v.parse(v.object({program: ReturnProgramSchema}), originalHeldMetadata().held).program;
const riding = v.parse(v.object({approach: ReturnProgramSchema}), structuredClone(NALATI_RIDING_PROGRAMS)).approach;

test('the seven real return consumers reserve seven isolated memories and initialize only at their original construction', () => {
  const entered = new Scope('prepared.entered'), level = new Scope('prepared.level');
  lendNalatiTitan(entered); lendNalatiTitan(level);
  const consumers = [[admission, entered], [titanRawPrograms.attack, level], [titanRawPrograms.wind, level], [held, level],
    [admission, level], [held, entered], [riding, entered]] as const;
  const NativeMemory = WebAssembly.Memory, NativeInstance = WebAssembly.Instance;
  const allocated: WebAssembly.Memory[] = [], imported: WebAssembly.ImportValue[] = [];
  const memory = vi.spyOn(WebAssembly, 'Memory'), storage = vi.spyOn(FixedMemory.prototype, 'value', 'get');
  // The existing bank may return native identities created before this spy.
  Object.defineProperty(memory, Symbol.hasInstance, { configurable: true, value: (value: unknown) => value instanceof NativeMemory });
  const instance = vi.spyOn(WebAssembly, 'Instance').mockImplementation(class extends NativeInstance {
    constructor(module: WebAssembly.Module, imports?: WebAssembly.Imports) {
      super(module, imports); const value = imports?.['env']?.['memory']; if (value === undefined) throw new Error('Missing original imported memory'); imported.push(value);
    }
  });
  try {
    for (const [row, scope] of consumers) expect(ReturnProgram.prepareMemory(row, scope)).toBe(true);
    for (const result of storage.mock.results) if (result.type === 'return') allocated.push(result.value);
    expect(memory.mock.calls.length).toBeLessThanOrEqual(7);
    expect(allocated).toHaveLength(7); expect(new Set(allocated).size).toBe(7); expect(imported).toHaveLength(0);
    for (const value of allocated) expect(new Uint8Array(value.buffer).every(byte => byte === 0)).toBe(true);
    for (const [row, scope] of consumers) expect(ReturnProgram.prepareMemory(structuredClone(row), scope)).toBe(false);
    const programmes = consumers.map(([row, scope]) => ReturnProgram.page(row, scope));
    expect(imported).toEqual(allocated); expect(allocated).toHaveLength(7);
    for (const [index, [row, scope]] of consumers.entries()) {
      expect(ReturnProgram.prepareMemory(row, scope)).toBe(false); expect(ReturnProgram.page(row, scope)).toBe(programmes[index]);
    }
    expect(ReturnProgram.page(titanRawPrograms.rules, level)).toBe(programmes[1]);
    expect(ReturnProgram.page(titanRawPrograms.fire, level)).toBe(programmes[2]);
    expect(imported).toHaveLength(7);
    // Full initialized bytes match a direct isolated instance for every consumer,
    // including pasture's shared group lane and the riding continuation bank.
    memory.mockRestore(); instance.mockRestore();
    for (const [index, [row]] of consumers.entries()) {
      const direct = new Scope(`direct.${String(index)}`), images: WebAssembly.Memory[] = [];
      const capture = vi.spyOn(WebAssembly, 'Instance').mockImplementation(class extends NativeInstance {
        constructor(module: WebAssembly.Module, imports?: WebAssembly.Imports) {
          super(module, imports); const importedMemory = imports?.['env']?.['memory'];
          if (!(importedMemory instanceof NativeMemory)) throw new Error('Missing direct memory'); images.push(importedMemory);
        }
      });
      try {
        lendNalatiTitan(direct); ReturnProgram.page(row, direct);
        const originalMemory = images[0], preparedMemory = allocated[index];
        if (originalMemory === undefined || preparedMemory === undefined) throw new Error('Missing initialized memory');
        expect(images).toHaveLength(1); expect(new Uint8Array(preparedMemory.buffer)).toEqual(new Uint8Array(originalMemory.buffer));
      } finally { capture.mockRestore(); direct.dispose(); }
    }
    const prepared = programmes[1]; if (prepared === undefined) throw new Error('Missing Titan programme');
    const original = ReturnProgram.page(titanPrograms.attack), a = new Rng(44), b = new Rng(44);
    const observations = {phase:0,mode:3,dt:2,t:0,cd:0,x:0,z:0,px:1,pz:1,chain:0,aim:1,lock:.2,stuck:.5};
    expect(prepared.project('spear', observations, a)).toEqual(original.project('spear', observations, b));
    expect(a.snapshot()).toEqual(b.snapshot());
  } finally { memory.mockRestore(); instance.mockRestore(); storage.mockRestore(); entered.dispose(); level.dispose(); }
});

test('preparation keeps full raw loan, descriptor, witness and retirement refusals before allocation', () => {
  const owner = new Scope('prepare.refusal'), foreign = new Scope('prepare.foreign'), NativeMemory = WebAssembly.Memory, memory = vi.spyOn(WebAssembly, 'Memory');
  // The observer must recognize pre-existing native identities returned by the bank.
  Object.defineProperty(memory, Symbol.hasInstance, { configurable: true, value: (value: unknown) => value instanceof NativeMemory });
  try {
    expect(() => ReturnProgram.prepareMemory(titanRawPrograms.attack, owner)).toThrow('raw return module loan'); expect(memory).not.toHaveBeenCalled();
    lendNalatiTitan(owner);
    const changed = structuredClone(titanRawPrograms.attack); changed.v2.artifact.hash = '0'.repeat(64);
    expect(() => ReturnProgram.prepareMemory(changed, owner)).toThrow(); expect(memory).not.toHaveBeenCalled();
    expect(() => ReturnProgram.prepareMemory({...titanRawPrograms.attack, bytes: 'AA=='}, owner)).toThrow('hash mismatch'); expect(memory).not.toHaveBeenCalled();
    let reads = 0;
    expect(() => ReturnProgram.prepareMemory({...titanRawPrograms.attack, get v2() { reads++; return titanRawPrograms.attack.v2; }}, owner)).toThrow('JSON data');
    expect(reads).toBe(0); expect(memory).not.toHaveBeenCalled();
    const before = scriptMemoryCensus();
    expect(ReturnProgram.prepareMemory(titanRawPrograms.attack, owner)).toBe(true);
    const allocated = memory.mock.calls.length, after = scriptMemoryCensus();
    expect(after.hits + after.misses - before.hits - before.misses).toBe(1); expect(allocated).toBeLessThanOrEqual(1);
    const different = structuredClone(titanRawPrograms.attack); different.script.id = 'fixture.changed';
    expect(() => ReturnProgram.prepareMemory(different, owner)).toThrow('declaration changed');
    expect(() => ReturnProgram.page(different, owner)).toThrow('declaration changed');
    expect(() => ReturnProgram.page(titanRawPrograms.attack, foreign)).toThrow('raw return module loan'); expect(memory).toHaveBeenCalledTimes(allocated);
    expect(ReturnProgram.prepareMemory({script: titanPrograms.attack.script, bytes: titanPrograms.attack.bytes}, owner)).toBe(false);
    owner.dispose();
    expect(() => ReturnProgram.prepareMemory(titanRawPrograms.attack, owner)).toThrow('owner disposed');
    expect(() => ReturnProgram.page(titanRawPrograms.attack, owner)).toThrow('owner disposed'); expect(memory).toHaveBeenCalledTimes(allocated);
  } finally { owner.dispose(); foreign.dispose(); memory.mockRestore(); }
});

test('a native reservation cannot be forged, reused, transferred, or consumed with other bytes', () => {
  const scope = new Scope('project.token'), other = new Scope('project.other'), token = prepareScriptMemory(titanModuleBytes, scope);
  const options = {seed: [0, 0] as const, initFuel: 400000, output: []};
  const build = (memory: typeof token, owner = scope, bytes = titanModuleBytes): ScriptModuleV2 => new ScriptModuleV2(bytes, {...options, prepared: {memory, scope: owner}});
  try {
    expect(Object.isFrozen(token)).toBe(true); expect(Object.keys(token)).toEqual(['pages']);
    expect(() => build({pages: token.pages})).toThrow('reservation'); expect(() => build(token, other)).toThrow('reservation');
    expect(() => build(token, scope, Uint8Array.from([...titanModuleBytes, 0, 1, 0]))).toThrow('reservation');
    const first = build(token), second = build(prepareScriptMemory(titanModuleBytes, other), other);
    expect(first.memory).not.toBe(second.memory); expect(new Uint8Array(first.memory.buffer)).toEqual(new Uint8Array(second.memory.buffer));
    new Uint8Array(first.memory.buffer)[0] = 99; expect(new Uint8Array(second.memory.buffer)[0]).not.toBe(99);
    expect(() => build(token)).toThrow('reservation');
    const abandoned = prepareScriptMemory(titanModuleBytes, scope); scope.dispose();
    expect(() => build(abandoned)).toThrow('reservation'); expect(() => prepareScriptMemory(titanModuleBytes, scope)).toThrow('ended');
  } finally { scope.dispose(); other.dispose(); }
});
