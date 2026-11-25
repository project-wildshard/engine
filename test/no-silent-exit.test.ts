// J501 (Jake, 2026-11-23 ~11:40 Cancún: "What kind of lint rule or agent can we fucking do in the engine to like not have these
// fucking silent failures?"): no page in src/client leaves play without saying why first. The title shows the drop modal for any
// navigation that said nothing only if it can tell it was not the player's: an unmarked `location.reload()` reads as the player's own
// reload and lands on a quiet title (roomsRevision.ts, Signal Dunes r6, QA-FEEDBACK-2026-11-23-b rows 20 and 22).
//
// The rule, per navigation (location.reload/replace/assign, location.href =, replaceFresh, reloadFresh): in its own block, before it,
// the code says why: endPlay / reloadPlay / showEnd (src/client/engine/boot/endPlay.ts), recordDrop, markReload / markUnload (or a
// host's `leaving.unload`), or leftByPlayer for the player's own exit. A page with no world on it (the doctor, a zone's own page)
// says so with an `// exit: player` comment on the line. And a `catch` that shows the title says why too.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { expect, test } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const SCAN = 'src/client';
/** the funnel itself and the navigation helpers it calls */
const OWN = new Set(['src/client/engine/boot/endPlay.ts', 'src/client/engine/boot/freshPage.ts']);
const NAV = /\blocation\.(?:reload|replace|assign)\s*\(|\blocation\.href\s*=(?!=)|\b(?:replaceFresh|reloadFresh)\s*\(/gu;
const SAYS_WHY = /\b(?:endPlay|reloadPlay|showEnd|recordDrop|markReload|markUnload|leftByPlayer|unload)\s*\(/u;
/** a line that says why in words: `// exit: player (…)` for a page with no world, `// exit: marked (…)` where the mark sits outside the block */
const NOTE = /\/\/ exit: (?:player|marked)\b/u;

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(ROOT, path)).isDirectory()) return sources(path);
    return /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

/** the text with comments and quoted strings blanked (same length, so offsets and lines hold); a template literal stays, its `${}` is code */
export function blankComments(text: string): string {
  let out = '', quote = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i] ?? '', next = text[i + 1] ?? '';
    const blank = (ch: string): string => quote === '`' || ch === '\n' ? ch : ' ';
    if (quote !== '') {
      if (c === '\\') { out += blank(c) + blank(next); i++; continue; }
      if (c === quote) { quote = ''; out += c; continue; }
      out += blank(c); continue;
    }
    if (c === '\'' || c === '"' || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && next === '/') { const end = text.indexOf('\n', i); const stop = end < 0 ? text.length : end; out += ' '.repeat(stop - i); i = stop - 1; continue; }
    if (c === '/' && next === '*') { const end = text.indexOf('*/', i + 2); const stop = end < 0 ? text.length : end + 2; out += text.slice(i, stop).replace(/[^\n]/gu, ' '); i = stop - 1; continue; }
    out += c;
  }
  return out;
}

/** where the innermost block holding `at` opens */
function blockStart(code: string, at: number): number {
  let depth = 0;
  for (let i = at - 1; i >= 0; i--) {
    if (code[i] === '}') depth++;
    else if (code[i] === '{') { if (depth === 0) return i; depth--; }
  }
  return 0;
}
/** where the block opening at `open` closes */
function blockEnd(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) return i; }
  }
  return code.length;
}
const lineOf = (text: string, at: number): number => text.slice(0, at).split('\n').length;

/** every navigation in `text` that says nothing first, and every `catch` that shows the title without a word, as `file:line why` */
export function silentExits(file: string, text: string): string[] {
  if (OWN.has(file)) return [];
  const code = blankComments(text), lines = text.split('\n'), found: string[] = [];
  for (const match of code.matchAll(NAV)) {
    const at = match.index, line = lineOf(code, at);
    if (NOTE.test(lines[line - 1] ?? '')) continue;
    if (SAYS_WHY.test(code.slice(blockStart(code, at), at))) continue;
    found.push(`${file}:${String(line)} ${match[0].replace(/\s+/gu, '')} with no reason before it`);
  }
  for (const match of code.matchAll(/\bcatch\s*(?:\([^)]*\))?\s*\{/gu)) {
    const open = match.index + match[0].length - 1, body = code.slice(open, blockEnd(code, open));
    if (/\bshowPageTitle\s*\(/u.test(body) && !SAYS_WHY.test(body)) found.push(`${file}:${String(lineOf(code, match.index))} a catch shows the title with no reason`);
  }
  return found;
}

/** QA-FEEDBACK-2026-11-24 row 20 (Sentry WILDSHARD-GAME-BX and BP): a boot that finds the world on a newer revision than the page
 *  threw a plain Error, so the player read "the game failed to start". Such a throw must be the funnel's (`leaveForRoomsRevision`,
 *  a LeavingPlayError), never `throw new Error(… newer revision …)`. */
export function plainRevisionThrows(file: string, text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/\bthrow\s+(?:new\s+)?Error\s*\(/gu)) {
    const end = text.indexOf(';', match.index), statement = text.slice(match.index, end < 0 ? text.length : end);
    if (/newer (?:revision|version)/iu.test(statement)) found.push(`${file}:${String(lineOf(text, match.index))} throws a plain "newer revision" error`);
  }
  return found;
}

test('a page behind its world\'s revision reloads or shows the modal, never a plain boot error (QA 11-24 row 20)', () => {
  const found = sources(SCAN).flatMap((path) => plainRevisionThrows(path, readFileSync(join(ROOT, path), 'utf8')));
  expect(found, `${found.join('\n')}\n\nA page older than its zone's world leaves through leaveForRoomsRevision() (src/client/game/boot/roomsAhead.ts): `
    + 'the updating card, which reloads (REV-RELOAD) once the cook has its packs (QA 11-25 row 35).').toEqual([]);
  // the line Sentry filed as WILDSHARD-GAME-BX fails; the funnel's throw passes
  expect(plainRevisionThrows('a.ts', '  if (rooms !== undefined) throw new Error(`${bareSlug(slug)}: the world runs a newer revision (${rooms.slice(0, 12)}) than this page has. Reload to play it.`);\n'))
    .toEqual(['a.ts:1 throws a plain "newer revision" error']);
  expect(plainRevisionThrows('a.ts', '  if (rooms !== undefined) throw leaveForRoomsRevision(slug, rooms).error;\n')).toEqual([]);
});

test('no page leaves play without saying why first (J501)', () => {
  const found = sources(SCAN).flatMap((path) => silentExits(relative(ROOT, join(ROOT, path)).replaceAll('\\', '/'), readFileSync(join(ROOT, path), 'utf8')));
  expect(found, `${found.join('\n')}\n\nA page that leaves play by itself goes through endPlay() (src/client/engine/boot/endPlay.ts, J501); the game's own reload that `
    + 'resumes uses reloadPlay(); the player\'s own exit calls leftByPlayer() first (or, on a page with no world, `// exit: player` on the line).').toEqual([]);
});

test('the guard sees an unmarked reload, a marked one and a silent catch', () => {
  expect(silentExits('a.ts', 'function f() {\n  location.reload();\n}\n')).toEqual(['a.ts:2 location.reload( with no reason before it']);
  expect(silentExits('a.ts', 'function f() {\n  markReload("x"); location.reload();\n}\n')).toEqual([]);
  // the Signal Dunes drop (roomsRevision.ts before J501): a default reload that says nothing
  expect(silentExits('a.ts', 'export function heardRooms(word: unknown, reload: () => void = () => { location.reload(); }): void {\n  reload();\n}\n'))
    .toEqual(['a.ts:1 location.reload( with no reason before it']);
  expect(silentExits('a.ts', 'const go = () => { reloadPlay({ code: "REV-RELOAD", why: "x" }); };\nfunction g() {\n  replaceFresh("/");\n}\n')).toEqual(['a.ts:3 replaceFresh( with no reason before it']);
  expect(silentExits('a.ts', '// location.reload() in a comment\nconst u = "https://x/location.reload()";\n')).toEqual([]);
  expect(silentExits('a.ts', 'go(() => { location.assign("/"); }); // exit: player\n')).toEqual([]);
  expect(silentExits('a.ts', 'try { await x(); } catch (error) {\n  await showPageTitle();\n}\n')).toEqual(['a.ts:1 a catch shows the title with no reason']);
  expect(silentExits('a.ts', 'try { await x(); } catch (error) {\n  showEnd({ code: "RESTORE-FAIL", why: "x", error });\n  await showPageTitle();\n}\n')).toEqual([]);
});
