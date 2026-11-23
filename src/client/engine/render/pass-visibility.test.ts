import { expect, test } from 'vitest';
import { restorePassVisibility, restoringPassVisibility } from './passVisibility';

test('DF14: a pass restoring the visibility it borrowed says so only while it restores, even when the restore throws', () => {
  expect(restoringPassVisibility()).toBe(false);
  let inside = false;
  restorePassVisibility(() => { inside = restoringPassVisibility(); });
  expect(inside).toBe(true);
  expect(restoringPassVisibility()).toBe(false);
  expect(() => { restorePassVisibility(() => { throw new Error('restore failed'); }); }).toThrow('restore failed');
  expect(restoringPassVisibility()).toBe(false);
});
