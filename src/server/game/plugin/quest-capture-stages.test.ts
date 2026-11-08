// @vitest-environment node
import { bindBorrowedMethod } from '../../../shared/game/plugin/borrowed';
import { expect, test } from 'vitest';

test('a borrowed method keeps its receiver and resolution does not run it', () => {
  const owner = { changed: false, apply() { this.changed = true; } };
  const owners = new Map([['world', owner]]);
  const method = bindBorrowedMethod(owners, { owner: 'world', path: ['apply'] });
  expect(owner.changed).toBe(false); method(); expect(owner.changed).toBe(true);
  expect(() => bindBorrowedMethod(owners, { owner: 'world', path: ['constructor', 'prototype'] })).toThrow('Unsafe borrowed owner path');
});
