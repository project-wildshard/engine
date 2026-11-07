import { expect, test } from 'vitest';
import { bindBorrowedMethod, checkBorrowedOwnerPath, readBorrowedOwner, resolveBorrowedValue } from './borrowed';

test('value reads retain live owner and intermediate replacement with one own getter call', () => {
  const events: string[] = [];
  class Owners extends Map<string, unknown> {
    override has(key: string): boolean { events.push('has'); return super.has(key); }
    override get(key: string): unknown { events.push('get'); return super.get(key); }
  }
  let value = -0;
  const leaf = { get value() { events.push('value'); return value; } };
  let children = [leaf];
  const owner = { get children() { events.push('children'); return children; } };
  const owners = new Owners([['world', owner]]), row = { owner: 'world', path: ['children', 0, 'value'] };
  checkBorrowedOwnerPath(row);
  expect(Object.is(resolveBorrowedValue(owners, row), -0)).toBe(true);
  expect(events).toEqual(['has', 'get', 'children', 'value']);
  events.length = 0;
  value = 7;
  expect(resolveBorrowedValue(owners, row)).toBe(7);
  expect(events).toEqual(['has', 'get', 'children', 'value']);
  children = [{ get value() { return 11; } }];
  expect(resolveBorrowedValue(owners, row)).toBe(11);
  owners.set('world', { children: [{ value: 19 }] });
  expect(resolveBorrowedValue(owners, row)).toBe(19);
  const field = readBorrowedOwner(owners, row);
  expect(field?.value).toBe(19);
  expect(field?.key).toBe('value');
});

test('absent owners, optional nulls, primitive and missing fields keep their distinct refusals', () => {
  const owners = new Map<string, unknown>(), row = { owner: 'world', path: ['child', 'value'], optional: true };
  expect(() => resolveBorrowedValue(owners, row)).toThrow('Missing borrowed owner world');
  for (const owner of [null, undefined, { child: null }, { child: undefined }]) {
    owners.set('world', owner);
    expect(resolveBorrowedValue(owners, row)).toBeUndefined();
    expect(readBorrowedOwner(owners, row)).toBeNull();
    expect(() => resolveBorrowedValue(owners, { ...row, optional: false })).toThrow('Missing borrowed field world');
  }
  owners.set('world', { child: 4 });
  expect(() => resolveBorrowedValue(owners, row)).toThrow('Borrowed path must traverse objects');
  owners.set('world', {});
  expect(() => resolveBorrowedValue(owners, row)).toThrow('Missing borrowed field child');
  owners.set('world', { child: {} });
  expect(() => resolveBorrowedValue(owners, row)).toThrow('Missing borrowed field value');
  owners.set('world', { child: { value: undefined } });
  expect(resolveBorrowedValue(owners, row)).toBeUndefined();
});

test('only a final inherited callable is lent and its actual receiver is retained', () => {
  let getterCalls = 0;
  class Owner {
    value = 3;
    increment(): number { this.value++; return this.value; }
    get inheritedValue(): number { return this.value; }
    get inheritedMethod(): unknown { getterCalls++; const method: unknown = Reflect.get(this, 'increment'); return method; }
  }
  const owner = new Owner(), owners = new Map<string, unknown>([['world', owner]]);
  const methodRow = { owner: 'world', path: ['increment'] }, method: unknown = Reflect.get(owner, 'increment');
  expect(resolveBorrowedValue(owners, methodRow)).toBe(method);
  expect(owner.value).toBe(3);
  expect(resolveBorrowedValue(owners, { owner: 'world', path: ['inheritedMethod'] })).toBe(method);
  expect(getterCalls).toBe(2);
  const field = readBorrowedOwner(owners, methodRow);
  expect(field?.receiver).toBe(owner);
  expect(bindBorrowedMethod(owners, methodRow)()).toBe(4);
  expect(() => resolveBorrowedValue(owners, { owner: 'world', path: ['inheritedValue'] })).toThrow('Missing borrowed field inheritedValue');
  expect(() => resolveBorrowedValue(owners, { owner: 'world', path: ['increment', 'value'] })).toThrow('Missing borrowed field increment');
  for (const key of ['constructor', '__proto__', 'prototype', 'caller', 'callee', 'arguments']) {
    expect(() => readBorrowedOwner(owners, { owner: 'world', path: [key] })).toThrow('Unsafe borrowed owner path');
  }
});
