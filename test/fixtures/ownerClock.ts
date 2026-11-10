// oxlint-disable-next-line import/no-nodejs-modules -- Compare saved owner state exactly, with Node's own deep equality.
import { isDeepStrictEqual } from 'node:util';
import type { SimHost, SimValue } from '../../src/server/engine/sim';

// FAST-SLOW-TESTS: a test jumps one saved owner's clock instead of stepping through idle time. It goes through the
// owner's own save and quiet restore, the same contract every player save uses, so nothing test-only ships in the
// engine. The edit may touch only the clock fields the caller names, and the owner must read back exactly the edit.

type Path = readonly string[];
const changedPaths = (before: unknown, after: unknown, at: Path = []): Path[] => {
  if (isDeepStrictEqual(before, after)) return [];
  if (typeof before !== 'object' || before === null || typeof after !== 'object' || after === null
    || Array.isArray(before) !== Array.isArray(after)) return [at];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].flatMap(key => changedPaths((before as Record<string, unknown>)[key], (after as Record<string, unknown>)[key], [...at, key]));
};
/** `*` matches any one key (an array index included), so `ecology.pending.*.due` names every pending entry's due. */
const allowed = (path: Path, patterns: readonly string[]): boolean => patterns.some(pattern => {
  const parts = pattern.split('.');
  return parts.length === path.length && parts.every((part, i) => part === '*' || part === path[i]);
});

/** Jump the named owner's clock: `edit` gets a copy of its saved state and returns the jumped state. Throws if the
 * edit touches anything outside `clocks`, or if the restored owner does not save exactly the jumped state. */
export function jumpOwnerClock<S>(host: SimHost, owner: string, clocks: readonly string[], parse: (state: unknown) => S, edit: (state: S) => S): S {
  const adapter = host.adapters.get(owner);
  if (adapter === undefined) throw new Error(`No saved owner ${owner}`);
  const before = structuredClone(adapter.snapshot()), jumped = edit(parse(structuredClone(before)));
  const stray = changedPaths(before, jumped).filter(path => !allowed(path, clocks));
  if (stray.length > 0) throw new Error(`A clock jump on ${owner} may not touch ${stray.map(path => path.join('.')).join(', ')}`);
  // The save wire is JSON: a value that does not survive it fails the exact read-back below.
  const wire: SimValue = JSON.parse(JSON.stringify(jumped));
  adapter.restore(wire);
  if (!isDeepStrictEqual(adapter.snapshot(), jumped)) throw new Error(`${owner} did not restore the jumped clock exactly`);
  return jumped;
}
