import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { enteredTiles, noteEnteredTiles, type EnteredTileReadout } from './enteredTileReadout';

test('retiring an old readout cannot erase a newer owner and the final owner releases its reader', () => {
  const first = new Scope('native'), next = new Scope('data');
  const native: EnteredTileReadout = { render: new Set([1]), colliders: new Set([1]), bytes: new Map([[1, 24]]) };
  const data: EnteredTileReadout = { render: new Set([2, 3]), colliders: null, bytes: new Map([[2, 48]]) };
  try {
    noteEnteredTiles(first, () => native); expect(enteredTiles()).toBe(native);
    noteEnteredTiles(next, () => data); first.dispose(); expect(enteredTiles()).toBe(data);
    next.dispose(); expect(enteredTiles()).toBeNull();
    expect(() => noteEnteredTiles(first, () => native)).toThrow('owner left');
    expect(enteredTiles()).toBeNull();
  } finally { first.dispose(); next.dispose(); }
});
