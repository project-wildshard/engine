import { expect, test } from 'vitest';
import { clearCreationErrors } from './contextErrors';

const queued = (...errors: number[]): { NO_ERROR: 0; getError: () => number } => ({ NO_ERROR: 0, getError: () => errors.shift() ?? 0 });

test('a new context starts with nothing a driver left queued', () => {
  const context = queued(1280, 1282);
  expect(clearCreationErrors(context)).toEqual([1280, 1282]);
  expect(context.getError()).toBe(0);
});

test('a clean context costs one read, and a stuck one stops', () => {
  expect(clearCreationErrors(queued())).toEqual([]);
  expect(clearCreationErrors({ NO_ERROR: 0, getError: () => 1280 })).toHaveLength(8);
});
