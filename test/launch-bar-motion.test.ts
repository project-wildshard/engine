// QA-FEEDBACK 11-19 row 18 (Jake, a cold Home Screen open): "There shouldn't be a frozen image. It should have some kind of
// loading bar ... Something should move on this page." The static shell in index.html is the first thing iOS shows after its
// still launch image, before any module has run. Its bar's sweep is a compositor animation (transform only), so it keeps
// moving while the bundles' code holds the main thread; it starts mid-bar, so the first frame already shows it; and under
// reduced motion it pulses instead of stopping.
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';

const html = readFileSync('index.html', 'utf8');
const style = /<style>([\s\S]*?)<\/style>/u.exec(html)?.[1] ?? '';
const reduced = /@media \(prefers-reduced-motion: reduce\) \{([^@]*?\.ws-launch-bar::after[^@]*?)\}\s*\n/u.exec(style)?.[1] ?? '';
const plain = style.replace(/@media[^{]*\{[^@]*?\}\s*\}/gu, '');
const rule = (css: string, selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  return at < 0 ? '' : css.slice(at, css.indexOf('}', at));
};
const keyframes = (name: string): string => new RegExp(`@keyframes ${name} \\{([\\s\\S]*?\\})\\s*\\}`, 'u').exec(style)?.[1] ?? '';

test('the launch bar sweeps from the first frame, on the compositor', () => {
  const sweep = rule(plain, '.ws-launch-bar::after');
  const animation = /animation: (\S+) ([\d.]+)s linear (-[\d.]+)s infinite/u.exec(sweep);
  expect(animation, sweep).not.toBeNull();
  const [, name = '', duration = '0', delay = '0'] = animation ?? [];
  // a negative delay under one period: the highlight is already part-way along the bar when the first frame is painted
  expect(Number(delay)).toBeLessThan(0);
  expect(-Number(delay)).toBeLessThan(Number(duration));
  const frames = keyframes(name);
  expect(frames).toMatch(/transform: translateX/u);
  // only transform moves: left, width or margin would be laid out on the main thread and freeze while code runs
  expect(frames).not.toMatch(/\b(?:left|right|width|margin)\s*:/u);
  expect(sweep).toContain('will-change: transform');
});

test('reduced motion pulses the bar; it never stands still', () => {
  expect(reduced).toContain('.ws-launch-bar::after');
  expect(reduced).not.toMatch(/animation: none/u);
  const animation = /animation: (\S+) [\d.]+s/u.exec(reduced)?.[1] ?? '';
  expect(animation).not.toBe('');
  expect(animation).not.toBe('ws-launch-sweep');
  const frames = keyframes(animation);
  expect(frames).toMatch(/opacity/u);
  expect(frames).not.toMatch(/transform|left|width/u);
});
