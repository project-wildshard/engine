import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the shipped client sources: the guard is about what they contain.
import { readdirSync, readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Join the repo-relative source roots.
import { join } from 'node:path';

const ROOTS = ['src/client', 'src/shared'];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(?:ts|mts|js|mjs)$/u.test(entry.name) && !/\.test\.|\.d\.ts$/u.test(entry.name) ? [path] : [];
  });
}

test('RL6 (Jake 2026-11-09, "i sometimes see confirm reload"): no client code can raise the browser\'s leave prompt', () => {
  const offenders: string[] = [];
  for (const file of ROOTS.flatMap(sources)) {
    const text = readFileSync(file, 'utf8');
    // the prompt needs a beforeunload handler that cancels it: returnValue, preventDefault inside one, or onbeforeunload
    if (/onbeforeunload|\.returnValue\s*=/u.test(text)) offenders.push(`${file}: onbeforeunload / returnValue`);
    for (const match of text.matchAll(/['"]beforeunload['"][^;]*?(?:=>|function)[^;]*?preventDefault/gu)) offenders.push(`${file}: ${match[0].slice(0, 80)}`);
  }
  // a save belongs before the navigation (lastEnd.ts leaveSaved), never in a leave prompt
  expect(offenders).toEqual([]);
});
