// @vitest-environment happy-dom
// QA row 13 (Jake, 2026-11-12: "wheres my dev FPS and dev memory in staging on desktop lol"): on a desktop the Developer dock sat
// 3 px off the bottom edge in 8 px type, under the window's rounded corner, and Jake saw only a sliver of it. The real stylesheets'
// cascade: on a desktop window the dock is anchored to the top-left corner (the same place in every world: it is one element on
// <body>), well inside the window, in readable type, and stops short of the boss bar. happy-dom matches neither a media query
// list nor (pointer: …), so the phone's PAUSE row (perf.css's `(max-width: 700px), (pointer: coarse)` block) and the real
// boxes are checked in Chromium by scripts/hud-worst.mjs --check: every Developer surface inside the window, 8 px clear of each edge.
// oxlint-disable-next-line import/no-nodejs-modules -- the real stylesheets, not a copy of them
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it } from 'vitest';

interface HappyWindow { happyDOM?: { setViewport: (size: { width: number; height: number }) => void } }
const view = (width: number, height: number): void => { (window as unknown as HappyWindow).happyDOM?.setViewport({ width, height }); };

let dock: HTMLElement, pill: HTMLElement, card: HTMLElement;
beforeEach(() => {
  const style = document.createElement('style');
  style.textContent = ['src/client/engine/ui/perf.css', 'src/client/game/grid/budgetOverlay.css'].map(file => readFileSync(file, 'utf8')).join('\n');
  document.head.append(style);
  dock = document.createElement('div'); dock.className = 'ws-perf-dock';
  pill = document.createElement('button'); pill.className = 'ws-perf';
  pill.innerHTML = '<b>120</b><span class="ws-perf-ms">max 9 ms</span><span class="ws-perf-long">8.3 / 9.3 ms · max 9 ms · 118 calls · 541k tris · desktop · bench</span>';
  card = document.createElement('div'); card.className = 'ws-grid-budget'; card.innerHTML = '<i class="ws-grid-budget-label">mem</i><b class="ws-grid-budget-gb">1.16</b>';
  dock.append(pill, card); document.body.append(dock);
});
afterEach(() => { document.head.innerHTML = ''; document.body.replaceChildren(); view(1024, 768); });

const px = (value: string): number => { const match = /(-?\d+(?:\.\d+)?)px/u.exec(value); return match === null ? Number.NaN : Number(match[1]); };

it.each([[2576, 1230], [1440, 900]] as const)('anchors the desktop dock top-left, inside a %ix%i window, in readable type', (width, height) => {
  view(width, height);
  const d = getComputedStyle(dock);
  expect(d.position).toBe('fixed');
  expect(['', 'auto']).toContain(d.bottom); // never hung off the bottom edge again
  expect(px(d.top)).toBeGreaterThanOrEqual(8); expect(px(d.left)).toBeGreaterThanOrEqual(8);
  // stops 36 px short of the boss bar's left edge (50vw - min(29vw, 390px), boss.css)
  expect(d.maxWidth).toContain(`${String(width / 2)}px - min(`); expect(d.maxWidth).toContain('390px) - 36px');
  expect(px(getComputedStyle(pill).fontSize)).toBeGreaterThanOrEqual(10);
  expect(getComputedStyle(pill).whiteSpace).toBe('normal'); // the long line wraps inside the dock instead of running on
  expect(getComputedStyle(card).display).toBe('flex');
});
