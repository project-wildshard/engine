// @vitest-environment happy-dom
// QA-FEEDBACK 11-19 row 28 (Jake, Mossgate on his iPhone, screenshot c4664087): "the vitals bar is a blank white bar with
// no heart or number". It is the zone's declared counter (the Template's LANTERN OIL, band.3): the engine drew it as a bare
// <meter> whose name sat only in aria-label, and iOS paints an unstyled meter as its own grey-white bar. A declared counter
// is a status row that says what it counts and how much, in the HUD's own bar.
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import type { SystemSpec } from '../app/systems';
import { mountDeclaredHud, type DeclaredCounter } from './declared';

const oil: DeclaredCounter = { kind: 'counter', id: 'template.oil', label: 'LANTERN OIL', band: 'band.3', order: 20, min: 0, max: 1, field: 'template.lantern.oil' };
let scope = new Scope('declared-counter-test');
afterEach(() => { scope.dispose(); scope = new Scope('declared-counter-test'); document.body.replaceChildren(); });

function mount(counter: DeclaredCounter, values: Map<string, number>): { row: HTMLElement; frame: () => void; meter: HTMLMeterElement | undefined } {
  const systems: SystemSpec[] = [], placed: HTMLElement[] = [];
  const handles = mountDeclaredHud([counter], {
    hud: { pin: () => undefined, widget: (_band, el) => { placed.push(el); document.body.append(el); }, relabel: () => () => undefined },
    system: (spec) => { systems.push(spec); }, scope, read: (field) => values.get(field) ?? 0 });
  const [row] = placed;
  if (row === undefined) throw new Error('The counter is on the HUD');
  return { row, frame: () => { for (const system of systems) system.run(1 / 60, 0); }, meter: handles.counters.get(counter.id) };
}
const shown = (row: HTMLElement): string => [...row.querySelectorAll<HTMLElement>('*')]
  .filter(el => el.getAttribute('aria-hidden') === 'true' || el.closest('meter') === null)
  .filter(el => el.children.length === 0 && el.tagName !== 'METER').map(el => el.textContent.trim()).filter(Boolean).join(' ');

test('a declared counter is a HUD row that names what it counts and shows how much, never a bare native meter', () => {
  const values = new Map([['template.lantern.oil', 0.6]]);
  const { row, meter } = mount(oil, values);
  expect(row.tagName).not.toBe('METER');
  expect(row.classList.contains('ws-touch-declared-counter')).toBe(true);
  expect(shown(row)).toBe('LANTERN OIL 60%');
  const fill = row.querySelector<HTMLElement>('.ws-touch-declared-counter-bar i');
  expect(fill?.style.width).toBe('60%');
  // the value stays readable to assistive tech, on the meter the handles name
  expect(meter?.value).toBeCloseTo(0.6);
  expect(meter?.getAttribute('aria-label')).toBe('LANTERN OIL');
  expect(row.contains(meter ?? null)).toBe(true);
});

test('the row follows the field each frame: the fill, the number and the meter together', () => {
  const values = new Map([['template.lantern.oil', 1]]);
  const { row, frame, meter } = mount(oil, values);
  expect(shown(row)).toBe('LANTERN OIL 100%');
  values.set('template.lantern.oil', 0.25); frame();
  expect(shown(row)).toBe('LANTERN OIL 25%');
  expect(row.querySelector<HTMLElement>('.ws-touch-declared-counter-bar i')?.style.width).toBe('25%');
  expect(meter?.value).toBeCloseTo(0.25);
  values.set('template.lantern.oil', 0); frame();
  expect(shown(row)).toBe('LANTERN OIL 0%');
  expect(row.querySelector<HTMLElement>('.ws-touch-declared-counter-bar i')?.style.width).toBe('0%');
});

test('a count wider than one reads as a count: 2 / 5', () => {
  const braziers: DeclaredCounter = { ...oil, id: 'braziers', label: 'BRAZIERS', band: 'band.2', min: 0, max: 5, field: 'lit' };
  const { row } = mount(braziers, new Map([['lit', 2]]));
  expect(shown(row)).toBe('BRAZIERS 2 / 5');
  expect(row.querySelector<HTMLElement>('.ws-touch-declared-counter-bar i')?.style.width).toBe('40%');
});

test('a value outside its range draws a full or empty bar, never past the row', () => {
  const values = new Map([['template.lantern.oil', 3]]);
  const { row, frame } = mount(oil, values);
  expect(row.querySelector<HTMLElement>('.ws-touch-declared-counter-bar i')?.style.width).toBe('100%');
  values.set('template.lantern.oil', -2); frame();
  expect(row.querySelector<HTMLElement>('.ws-touch-declared-counter-bar i')?.style.width).toBe('0%');
});
