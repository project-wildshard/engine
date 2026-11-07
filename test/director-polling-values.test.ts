import { expect, test } from 'vitest';
import { compileDirectorWhen, evaluateDirectorWhen, type DirectorWhenInstruction } from '@wildshard/format/directorWhen';
import { DirectorStageLane } from '../src/shared/game/plugin/director';

/** Frozen original stack interpreter: directorWhen.ts at e805fb4e33. */
function original(instructions: readonly DirectorWhenInstruction[], observation: Readonly<Record<string, boolean>>): boolean {
  const stack: boolean[] = [];
  for (const instruction of instructions) {
    if ('input' in instruction) {
      const value = observation[instruction.input];
      if (!Object.hasOwn(observation, instruction.input) || typeof value !== 'boolean') throw new Error('Invalid director condition observation');
      stack.push(value);
    } else if ('literal' in instruction) stack.push(instruction.literal);
    else {
      const right = stack.pop();
      if (right === undefined) throw new Error('Invalid director condition program');
      if (instruction.op === 'not') stack.push(!right);
      else {
        const left = stack.pop();
        if (left === undefined) throw new Error('Invalid director condition program');
        stack.push(instruction.op === 'and' ? left && right : left || right);
      }
    }
  }
  if (stack.length !== 1 || stack[0] === undefined) throw new Error('Invalid director condition program');
  return stack[0];
}

test('every boolean observation retains the original interpreter value and malformed-program refusals', () => {
  const names = ['a', 'b', 'c', 'd'];
  for (const text of ['true', 'false', '!a', 'a && b || c', '!(a || b) && (c || !d)', 'a && (b || (c && !d))']) {
    const program = compileDirectorWhen(text, names);
    for (let bits = 0; bits < 16; bits++) {
      const observation = { a: (bits & 1) !== 0, b: (bits & 2) !== 0, c: (bits & 4) !== 0, d: (bits & 8) !== 0 };
      expect(evaluateDirectorWhen(program, observation)).toBe(original(program, observation));
    }
  }
  for (const program of [[], [{ op: 'not' }], [{ op: 'and' }], [{ literal: true }, { literal: false }]] satisfies DirectorWhenInstruction[][]) {
    expect(() => original(program, {})).toThrow('Invalid director condition program');
    expect(() => evaluateDirectorWhen(program, {})).toThrow('Invalid director condition program');
  }
  const program = compileDirectorWhen('a', names), malformed = { a: true };
  Reflect.set(malformed, 'a', 0);
  for (const observation of [{}, malformed]) {
    expect(() => original(program, observation)).toThrow('Invalid director condition observation');
    expect(() => evaluateDirectorWhen(program, observation)).toThrow('Invalid director condition observation');
  }
});

test('nested getters, thrown getters and over-bound stacks retain independent results and recovery', () => {
  const run = (evaluate: typeof original): { value: boolean; reads: number } => {
    const program = compileDirectorWhen('a && !b', ['a', 'b']); let reads = 0;
    const nested = (depth: number): boolean => evaluate(program, { get a() { reads++; return depth === 0 || nested(depth - 1); }, b: false });
    expect(() => evaluate(program, { get a(): boolean { nested(12); throw new Error('original getter refusal'); }, b: false })).toThrow('original getter refusal');
    const large: DirectorWhenInstruction[] = Array.from({ length: 256 }, () => ({ literal: true }));
    for (let at = 1; at < 256; at++) large.push({ op: 'and' });
    expect(evaluate(large, {})).toBe(true);
    return { value: nested(12), reads };
  };
  expect(run(evaluateDirectorWhen)).toEqual(run(original));
});

const rows = { version: 2, id: 'polling', inputs: { b: 'flag:b', a: 'flag:a' }, stages: [
  { id: 'start', do: [{ flag: { key: 'started', value: true } }], next: [{ target: 'next', when: 'a && b' }] },
  { id: 'next', do: [{ toast: 'finished' }], next: 'start' },
] };
test('stage polling preserves native key/getter order and refreshes legacy order only on restore', () => {
  const lane = new DirectorStageLane(rows), log: string[] = [];
  const observation = { get a() { log.push('a'); return true; }, get b() { log.push('b'); return true; } };
  expect(lane.step(0, observation)).toEqual([{ flag: { key: 'started', value: true } }]); expect(log).toEqual(['b', 'a']);
  const saved = lane.snapshot(), copy = lane.data;
  const legacy = JSON.stringify({ version: 2, contract: { ...copy, inputs: { a: 'flag:a', b: 'flag:b' } }, state: { tick: 0, stage: 0 } });
  lane.restore(legacy); log.length = 0;
  expect(lane.step(1, observation)).toEqual([{ toast: 'finished' }]); expect(log).toEqual(['a', 'b', 'a', 'b']);
  lane.restore(saved); log.length = 0;
  expect(lane.step(1, observation)).toEqual([{ toast: 'finished' }]); expect(log).toEqual(['b', 'a', 'a', 'b']);
  expect(() => lane.step(1, observation)).toThrow('Invalid stage director tick');
  const before = lane.snapshot();
  expect(() => lane.step(2, { a: true, b: true, extra: true })).toThrow('Invalid stage director observation');
  expect(lane.snapshot()).toBe(before);
  const inherited = { a: true, b: true }; Object.setPrototypeOf(inherited, { inherited: true });
  expect(lane.step(2, inherited)).toEqual([{ flag: { key: 'started', value: true } }]);
});

test('an input-free lane still refuses absent observations before any cursor mutation', () => {
  const lane = new DirectorStageLane({ version: 2, id: 'empty', inputs: {}, stages: [{ id: 'first' }] });
  const saved = lane.snapshot(), step = lane.step.bind(lane);
  for (const observation of [null, undefined]) {
    expect(() => { Reflect.apply(step, lane, [0, observation]); }).toThrow();
    expect(lane.snapshot()).toBe(saved);
  }
  expect(lane.step(0, {})).toEqual([]);
});
