// meta IPHONE13-DRIFTWOOD DW1 (mini-driftwood13): the route bench's numbers. The device half runs on the iPhone 13
// (meta project/evidence/iphone13-driftwood/).
import { expect, test } from 'vitest';
import { linkStages, linkTable } from '../scripts/memory/iphone/link.mjs';
import { legSummary, routeFor, routeTable, worstSegment, type LegSample } from '../scripts/memory/iphone/route.mjs';

const second = (frameMs: number[], extra: Partial<LegSample> = {}): LegSample => ({ seconds: 1, frames: frameMs.length, frameMs,
  updateMs: frameMs.map(() => 4), renderMs: frameMs.map(() => 6), gpuApproxMs: frameMs.map(() => 1), draws: 80, triangles: 700_000,
  programs: 120, delayMs: 100, jitterMs: 10, ...extra });

test('a leg counts its frames, its spikes over 33 and 50 ms, and its rate per 30 s', () => {
  const steady = Array.from({ length: 30 }, () => 33.3);
  const s = legSummary([second(steady), second([...steady.slice(0, 27), 60, 80, 34.5])]);
  expect(s.fps).toBe(30);
  expect(s.over50).toBe(2);
  expect(s.over33).toBe(3);
  expect(s.over50Per30s).toBe(30);
  expect(s.maxMs).toBe(80);
  expect(s.p50Ms).toBe(33.3);
  expect(s.programsMax).toBe(120);
  expect(s.delayMs).toBe(100);
});

test('a worker-free page reads no delay rather than zero', () => {
  expect(legSummary([second([16.7], { delayMs: null, jitterMs: null })]).delayMs).toBeNull();
});

test('the worst segment is the highest median p95 at that cap', () => {
  const leg = (name: string, cap: number, p95Ms: number) => ({ name, cap, error: null, nav: null,
    summary: { ...legSummary([second([16.7])]), p95Ms, over50Per30s: 0 } });
  const report = [{ legs: [leg('dock', 30, 40), leg('beach', 30, 70), leg('beach', 60, 90)] }, { legs: [leg('dock', 30, 45), leg('beach', 30, 50)] }];
  expect(worstSegment(report, 30).map(row => row.name)).toEqual(['beach', 'dock']);
  expect(worstSegment(report, 30)[0]?.p95Ms).toBe(50);
  expect(routeTable(report[0]?.legs ?? [])).toContain('| beach | 30 |');
});

test("Driftwood's route starts at the dock and ends in a fight", () => {
  const route = routeFor('driftwood-isle');
  expect(route[0]).toMatchObject({ name: 'dock spawn', kind: 'stand', seconds: 30 });
  expect(route.at(-1)?.kind).toBe('fight');
  expect(() => routeFor('nowhere')).toThrow(/No route for nowhere/u);
});

test('the link table times each stage from the last mark and names the biggest', () => {
  const at = { menu: 1.5, deck: 2, enter: 3, startDone: 4, downloadDone: 20, loadDone: 50, control: 52 };
  expect(linkStages(at)).toEqual({ menu: 1.5, 'zone select': 0.5, 'enter zone': 1, start: 1, download: 16, load: 30, 'to control': 2 });
  expect(linkStages({ menu: 1, control: 9 })['to control']).toBe(8);
  const table = linkTable([{ kind: 'cold', at }, { kind: 'cold', at: { ...at, control: null }, error: 'never reached control in 300 s' }]);
  expect(table).toContain('Biggest stage, cold: **load**, median 30 s.');
  expect(table).toContain('**cold median** (1)');
});
