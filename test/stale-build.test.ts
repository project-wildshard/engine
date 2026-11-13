import { expect, test } from 'vitest';
import { builtAtOf, entryStamp } from '../scripts/app-build/builtAt.mjs';

// STALE-BUILD (meta docs/plans/STALE-BUILD-PLAN.md, J321): the build's one time, and the entry's stamp and check
const at = '1794583800000';
/** run the entry's banner against a fake page; returns what it did */
function runEntry(page: { built?: number; take?: (stamp: number) => boolean }): { threw: boolean; dataset: Record<string, string>; asked: number[]; stamp: unknown } {
  const dataset: Record<string, string> = {}, asked: number[] = [];
  const global: Record<string, unknown> = { __WS_BUILT_AT__: page.built };
  if (page.take !== undefined) { const take = page.take; global['__wsStaleBuild'] = (stamp: number) => { asked.push(stamp); return take(stamp); }; }
  let threw = false;
  // oxlint-disable-next-line typescript/no-implied-eval -- the banner is source text; this runs it as the entry would
  try { new Function('globalThis', 'document', entryStamp(at))(global, { documentElement: { dataset } }); } catch { threw = true; }
  return { threw, dataset, asked, stamp: global['__WS_ENTRY_BUILT_AT__'] };
}

test('one build time: WS_BUILT_AT when given, else now; nothing else', () => {
  expect(builtAtOf(undefined, 42e11)).toBe('4200000000000');
  expect(builtAtOf(at)).toBe(at);
  expect(() => builtAtOf('yesterday')).toThrow('Invalid WS_BUILT_AT');
});

test('off build-app the entry has no stamp', () => {
  expect(entryStamp(undefined)).toBe('');
  expect(entryStamp('nope')).toBe('');
});

test('the entry stamps its time and asks the document screen with it', () => {
  const fresh = runEntry({ built: Number(at), take: () => false });
  expect(fresh).toEqual({ threw: false, dataset: {}, asked: [Number(at)], stamp: Number(at) });
});

test('a stale entry stops every module and stands down the self-reload', () => {
  const stale = runEntry({ built: Number(at), take: () => true });
  expect(stale.threw).toBe(true);
  expect(stale.dataset).toEqual({ booted: '' });
});

test('an entry from another build than its document is marked', () => {
  expect(runEntry({ built: Number(at) - 1, take: () => false }).dataset).toEqual({ stampMismatch: String(Number(at) - 1) });
  // a document without the screen (calibration) boots
  expect(runEntry({}).threw).toBe(false);
});
