// oxlint-disable-next-line import/no-nodejs-modules -- the real stylesheet, not a copy of it
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { talkPages } from './talkPages';

// J473 row 4 (Jake, 2026-11-19 grill wave 3): 17 pt text, 3 lines a page, the box just above the thumbs' disc row.
const mono = (text: string): number => text.length * 10;

test('J473 row 4: a line that wraps past 3 lines splits into pages at word breaks', () => {
  // 10 px a character in 200 px: twenty characters a line, three lines a page
  expect(talkPages('Easy, stranger.', mono, 200)).toEqual(['Easy, stranger.']);
  const line = "Easy, stranger. Name's Brass: I keep the peace in this canyon, or I did.";
  const pages = talkPages(line, mono, 200);
  expect(pages).toEqual(["Easy, stranger. Name's Brass: I keep the peace in this", 'canyon, or I did.']);
  expect(pages.join(' ')).toBe(line);
  // a word wider than a line takes its own line; nothing to wrap in leaves the line whole
  expect(talkPages('Supercalifragilistic hi', mono, 100, 1)).toEqual(['Supercalifragilistic', 'hi']);
  expect(talkPages('', mono, 100)).toEqual(['']);
  expect(talkPages('a b', mono, 0)).toEqual(['a b']);
});

test('J473 row 4: on a phone the talk box sits above the disc row, 12 px gutters, 17 px text kept at 3 lines, NEXT and LEAVE', () => {
  const css = readFileSync('src/client/engine/ui/styles/quest.css', 'utf8');
  const rule = (selector: string): string => css.split('\n').find((line) => line.startsWith(`${selector} {`))?.slice(selector.length + 2) ?? '';
  const box = rule('#hud.touch .ws-quest-talk');
  expect(box).toContain('left: calc(env(safe-area-inset-left, 0px) + 12px)');
  expect(box).toContain('right: calc(env(safe-area-inset-right, 0px) + 12px)');
  // the bar (max(15vh, 104px) + half the home inset), the disc row's 10 px gap, a disc (min(15vw, 84px)) and 10 px
  expect(box).toContain('bottom: calc(max(15vh, 104px) + max(env(safe-area-inset-bottom, 0px), var(--ws-home, 0px)) * 0.5 + min(15vw, 84px) + 20px)');
  expect(rule('#hud.touch .ws-quest-talk-text')).toContain('font-size: 17px; line-height: 1.3; min-height: 3.9em');
  expect(rule('#hud.touch .ws-quest-talk-leave')).toContain('display: inline-block');
});
