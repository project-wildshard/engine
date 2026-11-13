// @vitest-environment happy-dom
// OFFLINE OF14: Signal Dunes' offline failure dropped to a title that said "Infinite Wildshard ended unexpectedly last time".
// The grid's recovery guard (10 minutes after a recovery resume) turned a later one-shard page's crash into a "loop", and the
// loop's grid line won over the shard's own name. A one-shard page that ended unexpectedly is named; the grid keeps its line.
import { expect, test } from 'vitest';
import type { LastEnd } from '@wildshard/engine/boot/lastEnd';
import { endedNote } from './mainMenu';

const find = (slug: string): { name: string } | undefined => slug === 'sunscar-dunes' ? { name: 'Signal Dunes' } : undefined;
const end = (mode: string, slug: string, kind: LastEnd['kind'] = 'unexpected') => ({ kind, mode, slug });

test('OF14: a one-shard page that ended unexpectedly names itself on the next title, even inside the grid guard', () => {
  expect(endedNote(end('shard', 'sunscar-dunes'), false, find)).toBe('Signal Dunes ended unexpectedly last time.');
  expect(endedNote(end('shard', 'sunscar-dunes'), true, find)).toBe('Signal Dunes ended unexpectedly last time.');
});

test('OF14: the grid that ended unexpectedly, or loops, shows "Infinite Wildshard"', () => {
  expect(endedNote(end('grid', 'sunscar-dunes'), false, find)).toBe('Infinite Wildshard ended unexpectedly last time.');
  expect(endedNote(end('grid', 'sunscar-dunes'), true, find)).toBe('Infinite Wildshard ended unexpectedly last time.');
  expect(endedNote(end('', '', 'fresh'), true, find)).toBe('Infinite Wildshard ended unexpectedly last time.');
  expect(endedNote(end('', '', 'fresh'), false, find)).toBe('');
});
