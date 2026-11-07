import { expect, test } from 'vitest';
import { onCellField, onCellMethods } from './cellChanges';

test('overlapping method subscriptions restore the exact own and inherited methods', () => {
  class Target {
    value = 0;
    first(amount: number): number { this.value += amount; return this.value; }
    second(): number { return this.value; }
  }
  const target = new Target(), calls: string[] = [];
  const method = Object.getOwnPropertyDescriptor(Target.prototype, 'second');
  if (method === undefined) throw new Error('Missing original method');
  Object.defineProperty(target, 'second', { ...method, writable: false, enumerable: false });
  const prior = Object.getOwnPropertyDescriptor(target, 'second');
  const stopFirst = onCellMethods(target, ['first', 'second', 'value'], () => { calls.push('first'); });
  const firstWrapper: unknown = Reflect.get(target, 'first'), secondWrapper: unknown = Reflect.get(target, 'second');
  const stopSecond = onCellMethods(target, ['second'], () => { calls.push('second'); });
  expect(Reflect.get(target, 'second')).toBe(secondWrapper);
  expect(target.first(3)).toBe(3);
  expect(target.second()).toBe(3);
  expect(calls).toEqual(['first', 'first', 'second']);
  stopFirst(); stopFirst();
  expect(Object.hasOwn(target, 'first')).toBe(false);
  expect(Reflect.get(target, 'first')).toBe(Reflect.get(Target.prototype, 'first'));
  expect(Reflect.get(target, 'first')).not.toBe(firstWrapper);
  expect(Reflect.get(target, 'second')).toBe(secondWrapper);
  target.second();
  expect(calls).toEqual(['first', 'first', 'second', 'second']);
  stopSecond();
  expect(Object.getOwnPropertyDescriptor(target, 'second')).toEqual(prior);
});

test('method notification retains live listener additions and removals', () => {
  const calls: string[] = [], target = { run(): void { calls.push('native'); } };
  let stopLater = (): void => undefined, stopAdded = (): void => undefined;
  const added = (): void => { calls.push('added'); };
  const stopFirst = onCellMethods(target, ['run'], () => {
    calls.push('first'); stopLater();
    stopAdded = onCellMethods(target, ['run'], added);
  });
  stopLater = onCellMethods(target, ['run'], () => { calls.push('later'); });
  target.run();
  expect(calls).toEqual(['native', 'first', 'added']);
  stopFirst(); stopAdded();
  target.run();
  expect(calls).toEqual(['native', 'first', 'added', 'native']);
});

test('method cleanup preserves a later replacement and duplicate key semantics', () => {
  let notifications = 0;
  const original = (): number => 1, replacement = (): number => 2;
  const target = { run: original };
  const stop = onCellMethods(target, ['run', 'run'], () => { notifications++; });
  expect(target.run()).toBe(1); expect(notifications).toBe(1);
  target.run = replacement; stop(); stop();
  expect(target.run).toBe(replacement);
  const stopNew = onCellMethods(target, ['run'], () => { notifications++; });
  expect(target.run()).toBe(2); expect(notifications).toBe(2);
  stopNew(); expect(target.run).toBe(replacement);
});

test('native method failures propagate without publishing a change', () => {
  const failure = new Error('native refusal');
  let notifications = 0;
  const target = { run(): never { throw failure; } };
  const prior = Object.getOwnPropertyDescriptor(target, 'run');
  const stop = onCellMethods(target, ['run'], () => { notifications++; });
  expect(() => target.run()).toThrow(failure); expect(notifications).toBe(0);
  stop(); expect(Object.getOwnPropertyDescriptor(target, 'run')).toEqual(prior);
});

test('uninvoked shared methods stop notifying even through retained wrappers', () => {
  let notifications = 0, native = 0;
  const target = { first(): void { native++; }, second(): void { native++; } };
  const stop = onCellMethods(target, ['first', 'second'], () => { notifications++; });
  const first: unknown = Reflect.get(target, 'first'), second: unknown = Reflect.get(target, 'second');
  if (typeof first !== 'function' || typeof second !== 'function') throw new Error('Missing observed methods');
  stop(); stop();
  Reflect.apply(first, target, []); Reflect.apply(second, target, []);
  expect(native).toBe(2); expect(notifications).toBe(0);
});

test('reentrant subscription changes stay local to the selected method', () => {
  const calls: string[] = [];
  const target = { first(): void { calls.push('first'); }, second(): void { calls.push('second'); } };
  let add = true, stopExtra = (): void => undefined;
  const stop = onCellMethods(target, ['first', 'second'], () => {
    calls.push('base');
    if (add) { add = false; stopExtra = onCellMethods(target, ['second'], () => { calls.push('extra'); }); }
  });
  target.first(); target.first(); target.second();
  expect(calls).toEqual(['first', 'base', 'first', 'base', 'second', 'base', 'extra']);
  stop(); stopExtra();
});

test('removing and readding the current listener retains live Set order', () => {
  const calls: string[] = [];
  const target = { run(): void { calls.push('native'); }, untouched(): number { return 0; } };
  const prior = Object.getOwnPropertyDescriptor(target, 'untouched');
  let first = true, stop = (): void => undefined, stopExtra = (): void => undefined;
  const changed = (): void => {
    calls.push('base');
    if (first) {
      first = false;
      stopExtra = onCellMethods(target, ['run'], () => { calls.push('extra'); });
      stop(); stop = onCellMethods(target, ['run'], changed);
    }
  };
  stop = onCellMethods(target, ['run', 'untouched'], changed);
  target.run();
  expect(calls).toEqual(['native', 'base', 'extra', 'base']);
  stopExtra(); stop();
  expect(Object.getOwnPropertyDescriptor(target, 'untouched')).toEqual(prior);
});

test('method installation publishes no callback before defining the wrapper', () => {
  let notifications = 0, native = 0;
  const target: { run: () => void } = new Proxy({ run: (): void => { native++; } }, {
    defineProperty(object, key, descriptor): boolean {
      const value: unknown = descriptor.value;
      if (typeof value === 'function') Reflect.apply(value, object, []);
      return Reflect.defineProperty(object, key, descriptor);
    },
  });
  const stop = onCellMethods(target, ['run'], () => { notifications++; });
  expect(native).toBe(1); expect(notifications).toBe(0);
  target.run(); expect(native).toBe(2); expect(notifications).toBe(1);
  stop(); expect(notifications).toBe(1);
});

test('a watched absent field stays out of key walks until it holds a value', () => {
  // S3.7: a skinned geometry's watched morphAttributes.position read as a phantom (undefined) morph to Object.entries
  const morphs: Record<string, unknown> = {}, changes: unknown[] = [];
  const stop = onCellField(morphs, 'position', () => { changes.push(morphs['position']); });
  expect(Object.keys(morphs)).toEqual([]); expect(morphs['position']).toBeUndefined();
  morphs['position'] = [1]; expect(Object.keys(morphs)).toEqual(['position']);
  morphs['position'] = undefined; expect(Object.keys(morphs)).toEqual([]);
  morphs['position'] = [2]; stop();
  expect(Object.getOwnPropertyDescriptor(morphs, 'position')).toEqual({ value: [2], writable: true, enumerable: true, configurable: true });
  expect(changes).toEqual([[1], undefined, [2]]);
  const empty: Record<string, unknown> = {}, stopEmpty = onCellField(empty, 'position', () => undefined); stopEmpty();
  expect(Object.getOwnPropertyDescriptor(empty, 'position')).toBeUndefined();
});

test('field delivery retains snapshot order across warm writes and reentrant membership edits', () => {
  const target = { value: 0 }, calls: string[] = [];
  let editing = false, stopLater = (): void => undefined, stopAdded = (): void => undefined;
  const added = (): void => { calls.push(`added:${target.value}`); };
  const stopFirst = onCellField(target, 'value', () => {
    calls.push(`first:${target.value}`);
    if (!editing) return;
    editing = false;
    stopLater(); stopAdded = onCellField(target, 'value', added);
    target.value = 4;
  });
  stopLater = onCellField(target, 'value', () => { calls.push(`later:${target.value}`); });
  try {
    target.value = 1; target.value = 2;
    expect(calls).toEqual(['first:1', 'later:1', 'first:2', 'later:2']);
    calls.length = 0; editing = true; target.value = 3;
    expect(calls).toEqual(['first:3', 'first:4', 'added:4']);
    target.value = 5;
    expect(calls).toEqual(['first:3', 'first:4', 'added:4', 'first:5', 'added:5']);
  } finally { stopFirst(); stopLater(); stopAdded(); }
  expect(Object.getOwnPropertyDescriptor(target, 'value')).toEqual({ value: 5, configurable: true, writable: true, enumerable: true });
});

test('field snapshots retain removed-and-readded listeners and release retained setters', () => {
  const target = { value: 0 }, calls: string[] = [];
  let change = false, stopSecond = (): void => undefined;
  const second = (): void => { calls.push('second'); };
  const stopFirst = onCellField(target, 'value', () => {
    calls.push('first');
    if (change) { change = false; stopSecond(); stopSecond = onCellField(target, 'value', second); }
  });
  stopSecond = onCellField(target, 'value', second);
  target.value = 1; change = true; target.value = 2;
  expect(calls).toEqual(['first', 'second', 'first', 'second']);
  const setter = Object.getOwnPropertyDescriptor(target, 'value')?.set?.bind(target);
  if (setter === undefined) throw new Error('Missing retained field setter');
  stopFirst(); stopSecond();
  setter(3);
  expect(calls).toEqual(['first', 'second', 'first', 'second']);
  expect(target.value).toBe(2);
});

test('a field listener failure keeps the assigned value and original next-write order', () => {
  const target = { value: 0 }, calls: string[] = [], failure = new Error('listener refusal');
  let refuse = true;
  const first = onCellField(target, 'value', () => {
    calls.push(`first:${target.value}`);
    if (refuse) throw failure;
  });
  const second = onCellField(target, 'value', () => { calls.push(`second:${target.value}`); });
  try {
    expect(() => { target.value = 1; }).toThrow(failure);
    expect(target.value).toBe(1); expect(calls).toEqual(['first:1']);
    refuse = false; target.value = 2; target.value = 2;
    expect(calls).toEqual(['first:1', 'first:2', 'second:2']);
  } finally { first(); second(); }
  expect(Object.getOwnPropertyDescriptor(target, 'value')).toEqual({ value: 2, configurable: true, writable: true, enumerable: true });
});
