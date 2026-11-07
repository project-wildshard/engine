import { expect, test, vi } from 'vitest';
import { decisionMemoryPreparationPages, scriptAdmissionRows } from '@wildshard/format/scriptContract';
import { SCRIPT_V2_REVISIONS } from '@wildshard/format/scriptAdmissionV2';
import { prepareDecisionMemories } from './decisionModule';
import { Scope } from '../app/scope';

const script = (id: string, hash = 'a'.repeat(64), pages = 1) => ({
  id, abi: '1.0', side: 'sim', module: `blobs/wasm/${hash}.wasm`, source: `behaviour/${id}.as`,
  binding: { shard: true }, pages, onFail: 'hold', on: ['start'], reads: [], commands: [],
  stateVersion: 1, state: [], params: {},
});
const spawn = (id: string) => ({
  step: id, roster: 'members', seed: 1, script: script(id), bytes: '', controlState: 'state', maximum: 1,
  slots: [{ id: 'self', handle: 1 }], species: [{ id: 'animal', kind: 'animal', variant: 'plain' }],
  sites: [{ id: 'home', slot: 'self', point: [0, 0], face: 'player' }],
  spawns: [{ id: 'animal', species: 'animal', site: 'home' }], fields: [], flags: [], cues: [], channels: [], moves: [],
});
const pineShape = () => new Map<string, unknown>([
  ['sim/scripts', [script('king')]],
  ['actors/spawn-scripts', Array.from({ length: 5 }, (_, index) => spawn(`spawn${String(index)}`))],
  ['actors/return-scripts', [script('life'), script('shelter')]],
]);

test('one stateful sim module consumes one fresh preparation, while all eight rows stay admitted', async () => {
  const sections = pineShape(), beforeOwner = new Scope('full-inventory-plan'), owner = new Scope('memory-plan');
  const NativeMemory = WebAssembly.Memory, allocated: WebAssembly.Memory[] = [];
  const memory = vi.spyOn(WebAssembly, 'Memory').mockImplementation(class extends NativeMemory {
    constructor(descriptor: WebAssembly.MemoryDescriptor) { super(descriptor); allocated.push(this); }
  });
  try {
    expect(scriptAdmissionRows(sections)).toHaveLength(8);
    await prepareDecisionMemories(scriptAdmissionRows(sections).map(row => row.pages), beforeOwner);
    expect(allocated).toHaveLength(8);
    expect(decisionMemoryPreparationPages(sections)).toEqual([1]);
    const ready = prepareDecisionMemories(decisionMemoryPreparationPages(sections), owner);
    expect(prepareDecisionMemories(decisionMemoryPreparationPages(sections), owner)).toBe(ready);
    await ready;
    expect(allocated).toHaveLength(9); // Eight from the prior plan, one from the selected plan.
    expect(allocated[8]?.buffer.byteLength).toBe(65536);
    expect(allocated.slice(0, 8)).not.toContain(allocated[8]);
    expect(scriptAdmissionRows(sections)).toHaveLength(8);
  } finally { beforeOwner.dispose(); owner.dispose(); memory.mockRestore(); }
});

test('deduplication follows exact module identity and preserves distinct page counts', () => {
  const sections = new Map<string, unknown>([['sim/scripts', [script('first'), script('alias'), script('second', 'b'.repeat(64), 2)]]]);
  expect(scriptAdmissionRows(sections)).toHaveLength(3);
  expect(decisionMemoryPreparationPages(sections)).toEqual([1, 2]);
  sections.set('sim/scripts', [script('first'), script('conflict', 'a'.repeat(64), 2)]);
  expect(() => decisionMemoryPreparationPages(sections)).toThrow('Conflicting decision memory pages');
});

test('stateless and v2/view declarations keep admission without requesting fresh v1 memory', () => {
  const project = { id: 'project', abi: 2, side: 'sim', lane: 'project', module: `blobs/wasm/${'b'.repeat(64)}.wasm`, pages: 2,
    ioBytes: 656, compilerRevision: SCRIPT_V2_REVISIONS.compiler, admissionRevision: SCRIPT_V2_REVISIONS.admission };
  const sections = new Map<string, unknown>([
    ['actors/spawn-scripts', [spawn('spawn')]], ['actors/return-scripts', [script('return'), project]],
    ['view/modules', [{ ...project, id: 'view', side: 'view', lane: 'view' }]],
  ]);
  expect(scriptAdmissionRows(sections)).toHaveLength(4);
  expect(decisionMemoryPreparationPages(sections)).toEqual([]);
  expect(decisionMemoryPreparationPages()).toEqual([]);
});

test.each(['actors/spawn-scripts', 'actors/return-scripts', 'view/modules'])('unused %s still passes full admission', section => {
  const sections = pineShape(); sections.set(section, [{ invalid: true }]);
  expect(() => decisionMemoryPreparationPages(sections)).toThrow();
});
