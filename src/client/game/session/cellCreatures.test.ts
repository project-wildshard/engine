import { expect, test } from 'vitest';
import type { RowBodiesView } from '@wildshard/engine/entities/RowBodies';
import { forwardCellCreatures } from './cellCreatures';

interface Calls { onKill?: (a: unknown) => void; onSound?: (name: string, at: unknown) => void; onWindup?: (a: unknown, dur: number) => void }
const manager = (calls: Calls = {}): RowBodiesView => calls as unknown as RowBodiesView;

// QA 11-25 row 86 (c): a grid cell's creature manager runs the page's kill feed, cries and wind-up warning once each.
test("a cell's kill, cry and wind-up run its own callbacks and then the page's, once", () => {
  const said: string[] = [], wired = new WeakSet<RowBodiesView>();
  const page = manager({ onKill: () => { said.push('page kill'); }, onSound: name => { said.push(`page ${name}`); }, onWindup: (_a, dur) => { said.push(`page windup ${dur}`); } });
  const cell = manager({ onKill: () => { said.push('cell kill'); } }) as unknown as Calls;
  forwardCellCreatures(cell as unknown as RowBodiesView, page, wired);
  forwardCellCreatures(cell as unknown as RowBodiesView, page, wired); // a second frame wires nothing more
  cell.onKill?.({}); cell.onSound?.('boar_squeal', {}); cell.onWindup?.({}, 0.6);
  expect(said).toEqual(['cell kill', 'page kill', 'page boar_squeal', 'page windup 0.6']);
});

test("a callback the cell sets later keeps the page's, and the page's own reassignments are followed", () => {
  const said: string[] = [], wired = new WeakSet<RowBodiesView>();
  const page = manager() as unknown as Calls, cell = manager() as unknown as Calls;
  forwardCellCreatures(cell as unknown as RowBodiesView, page as unknown as RowBodiesView, wired);
  cell.onKill = () => { said.push('cell kill'); };
  page.onKill = () => { said.push('page kill'); };
  cell.onKill({});
  expect(said).toEqual(['cell kill', 'page kill']);
});

test('the page manager itself is never forwarded to itself', () => {
  const said: string[] = [], page = manager({ onKill: () => { said.push('page kill'); } }) as unknown as Calls;
  forwardCellCreatures(page as unknown as RowBodiesView, page as unknown as RowBodiesView, new WeakSet());
  page.onKill?.({});
  expect(said).toEqual(['page kill']);
});
