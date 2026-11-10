import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the shipped client sources: the guard is about what they contain.
import { readdirSync, readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Join the repo-relative source roots.
import { join } from 'node:path';

const ROOTS = ['src/client', 'src/shared'];
/** The one file allowed to raise the browser's leave prompt: KP4, Jake 2026-11-09 on his Mac, "show 'leave the game' and
 *  confirm for command W. Same for command T, command N, command Q". Its own rules keep RL6: it never asks on the title,
 *  in a menu, after markUnload / markReload, or after ⌘R / Ctrl+R / F5 (src/client/engine/ui/leaveGuard.test.ts). */
const SANCTIONED = 'src/client/engine/ui/leaveGuard.ts';

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.(?:ts|mts|js|mjs)$/u.test(entry.name) && !/\.test\.|\.d\.ts$/u.test(entry.name) ? [path] : [];
  });
}

/** Code without its comments, so a comment that names preventDefault is not a prompt. */
const code = (text: string): string => text.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/(^|[^:'"`])\/\/[^\n]*/gu, '$1');

/** Every file that can cancel a leave: onbeforeunload, a returnValue write, or a file that listens for beforeunload and
 *  calls preventDefault anywhere (file-wide, so a named handler declared away from its addEventListener still counts;
 *  today no other beforeunload file calls preventDefault at all). */
function promptRaisers(): string[] {
  return ROOTS.flatMap(sources).filter(file => {
    const text = code(readFileSync(file, 'utf8'));
    return /onbeforeunload|\.returnValue\s*=/u.test(text) || (/beforeunload/u.test(text) && /preventDefault/u.test(text));
  }).sort();
}

test('RL6 (Jake 2026-11-09, "i sometimes see confirm reload"): only the in-world leave guard can raise the browser\'s leave prompt', () => {
  // a save belongs before the navigation (lastEnd.ts leaveSaved), never in a leave prompt; a new prompt anywhere else fails
  // here. What keeps the sanctioned one off every reload the player asks for is proven by behaviour in leaveGuard.test.ts.
  expect(promptRaisers()).toEqual([SANCTIONED]);
});
