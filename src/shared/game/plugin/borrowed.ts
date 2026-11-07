/** A borrowed object capability, with an explicitly bounded property path. */
export interface BorrowedOwnerPath { readonly owner: string; readonly path: readonly (string | number)[]; readonly optional?: boolean }
/** The resolved field and its actual receiver; methods retain that receiver when lent to another host. */
export interface BorrowedOwnerValue { readonly receiver: Record<string, unknown>; readonly key: string; readonly value: unknown }
const borrowedRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';
/** Refuse an unbounded path, traversal and prototype keys (the row's own shape; it never changes once read). */
export function checkBorrowedOwnerPath(row: BorrowedOwnerPath): void {
  if (row.path.length === 0 || row.path.length > 16 || row.owner.length === 0 || row.owner.length > 96) throw new Error('Invalid borrowed owner path');
  for (const part of row.path) {
    if (typeof part === 'number' ? !Number.isSafeInteger(part) || part < 0 || part > 1024
      : !/^[A-Za-z][A-Za-z0-9_-]*$/u.test(part) || ['constructor', 'prototype', '__proto__', 'caller', 'callee', 'arguments'].includes(part)) throw new Error('Unsafe borrowed owner path');
  }
}

/** Resolve only a supplied owner. Refuse traversal, prototype keys and missing fields; optional null intermediates stay absent. */
export function readBorrowedOwner(owners: ReadonlyMap<string, unknown>, row: BorrowedOwnerPath): BorrowedOwnerValue | null {
  checkBorrowedOwnerPath(row);
  return resolveBorrowedOwner(owners, row);
}

/** `readBorrowedOwner` for a row whose path `checkBorrowedOwnerPath` already accepted: a per-frame read checks its path once. */
export function resolveBorrowedOwner(owners: ReadonlyMap<string, unknown>, row: BorrowedOwnerPath): BorrowedOwnerValue | null {
  const receiver = borrowedReceiver(owners, row); if (receiver === null) return null;
  const key = String(row.path.at(-1));
  return { receiver, key, value: receiver[key] };
}
/** `resolveBorrowedOwner`'s value alone (undefined where it is null), with no result object: a numeric input read every
 *  frame (G639: a sky's and every posed animal's channel inputs) */
export function resolveBorrowedValue(owners: ReadonlyMap<string, unknown>, row: BorrowedOwnerPath): unknown {
  return borrowedReceiver(owners, row, true);
}
/** Resolve live owners and intermediates; value-only reads consume the checked leaf key in the same walk.
 * Receiver reads return null for an optional null path; value reads retain their undefined result. */
function borrowedReceiver(owners: ReadonlyMap<string, unknown>, row: BorrowedOwnerPath, valueOnly: true): unknown;
function borrowedReceiver(owners: ReadonlyMap<string, unknown>, row: BorrowedOwnerPath): Record<string, unknown> | null;
function borrowedReceiver(owners: ReadonlyMap<string, unknown>, row: BorrowedOwnerPath, valueOnly = false): unknown {
  if (!owners.has(row.owner)) throw new Error(`Missing borrowed owner ${row.owner}`);
  let receiver = owners.get(row.owner);
  for (let index = 0; index < row.path.length; index++) {
    if (receiver === null || receiver === undefined) {
      if (row.optional === true) return valueOnly ? undefined : null;
      throw new Error(`Missing borrowed field ${row.owner}`);
    }
    if (!borrowedRecord(receiver)) throw new Error('Borrowed path must traverse objects');
    const key = String(row.path[index]), last = index === row.path.length - 1;
    // A class method may be inherited; fields and intermediate objects must belong to the supplied instance.
    // An own final getter runs once per read, after its ownership check.
    if (!Object.hasOwn(receiver, key) && !(last && typeof receiver[key] === 'function')) throw new Error(`Missing borrowed field ${key}`);
    if (last) return valueOnly ? receiver[key] : receiver;
    receiver = receiver[key];
  }
  throw new Error('Invalid borrowed owner path');
}

/** Borrow a required method with its actual receiver; resolution itself invokes nothing. */
export function bindBorrowedMethod(owners: ReadonlyMap<string, unknown>, row: BorrowedOwnerPath): (...args: readonly unknown[]) => unknown {
  const field = readBorrowedOwner(owners, row);
  const callable = (value: unknown): value is (...args: readonly unknown[]) => unknown => typeof value === 'function';
  if (field === null || !callable(field.value)) throw new Error('Missing borrowed owner method');
  const method = field.value;
  return (...args) => method.call(field.receiver, ...args);
}
