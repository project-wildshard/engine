// @vitest-environment node
// QA 11-24 row 69: a grid data cell's declared post look. Row 59 laid Nine Dragon's declared post look (its rain, ink lines and
// live light) over its data look on its own page; in the grid its data cell drew only its data sky. The cell now compiles the
// post look, contributes its chain for its instance, places its composite over the cell's view root and runs its frame hook,
// all freed with the cell.
import { expect, test } from 'vitest';
import { Group } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import type { LookCellContext, LookStrategy } from '@wildshard/engine/render/look';
import type { FrameLookContribution, FrameLookPort } from './frameLook';
import { layCellPost, type CellPostHost } from './cellDataPost';

interface Fixture {
  readonly look: LookStrategy; readonly host: CellPostHost; readonly calls: string[]; readonly built: LookCellContext[];
  readonly systems: { readonly id: string; readonly run: (dt: number, t: number) => void; readonly scope: Scope }[];
  readonly count: { prepared: number; framed: number; disposed: number };
}

function fixture(options: { readonly cell?: boolean; readonly composite?: boolean; readonly prepare?: () => Promise<void> } = {}): Fixture {
  const calls: string[] = [], built: LookCellContext[] = [], systems: Fixture['systems'][number][] = [];
  const count = { prepared: 0, framed: 0, disposed: 0 };
  const parts: LookStrategy = {
    mode: 'extend',
    compose: () => ({ chain: [] }),
    prepareWorld: async () => { count.prepared++; await options.prepare?.(); },
    frame: () => { count.framed++; },
    dispose: () => { count.disposed++; },
  };
  const look: LookStrategy = options.cell === false ? parts
    : { ...parts, cell: { replaces: 'chain', build: (c: LookCellContext) => { built.push(c); return { display: null as never }; } } };
  const port: FrameLookPort = {
    contribute: (instance, contribution) => { calls.push(`contribute ${instance} ${JSON.stringify(contribution.chain)}`); return () => { calls.push('uncontribute'); }; },
    ...(options.composite === false ? {} : { composite: (instance: string, _post: unknown, replaces?: 'chain' | 'tone') => { calls.push(`composite ${instance} ${String(replaces)}`); return () => { calls.push('uncomposite'); }; } }),
  };
  const host: CellPostHost = { port, camera: null as never, renderer: null as never, sky: null as never, addSystem: (system, scope) => { systems.push({ ...system, scope }); } };
  return { look, host, calls, built, systems, count };
}

const whole = (): FrameLookContribution => ({ chain: { whole: true } as never });

test('a post look compiles, contributes its chain, composites over the cell root and runs its frame, freed with the cell', async () => {
  const { look, host, calls, built, systems, count } = fixture(), scope = new Scope('cell'), root = new Group();
  expect(await layCellPost(look, whole, { instance: 'nine-1', root, scope }, host)).toBe('on');
  expect(count.prepared).toBe(1);
  expect(calls).toEqual(['contribute nine-1 {"whole":true}', 'composite nine-1 chain']);
  expect(built[0]?.root).toBe(root);
  expect(built[0]?.scope).toBe(scope);
  expect(systems.map(row => row.id)).toEqual(['grid.post.nine-1.frame']);
  expect(systems[0]?.scope).toBe(scope);
  systems[0]?.run(0.016, 1);
  expect(count.framed).toBe(1);
  scope.dispose();
  expect(calls.slice(2).sort()).toEqual(['uncomposite', 'uncontribute']);
  expect(count.disposed).toBe(1);
});

test('no cell composite on the look, or no composite on the frame: off, nothing placed, the look freed', async () => {
  for (const options of [{ cell: false }, { composite: false }]) {
    const { look, host, calls, systems, count } = fixture(options);
    expect(await layCellPost(look, whole, { instance: 'nine-1', root: new Group(), scope: new Scope('cell') }, host)).toBe('off');
    expect(calls).toEqual([]);
    expect(systems).toEqual([]);
    expect(count.disposed).toBe(1);
  }
});

test('a cell that leaves before or while its look compiles places nothing and frees the look', async () => {
  const gone = fixture(), left = new Scope('cell');
  left.dispose();
  expect(await layCellPost(gone.look, whole, { instance: 'nine-1', root: new Group(), scope: left }, gone.host)).toBe('off');
  expect(gone.count.disposed).toBe(1);
  expect(gone.count.prepared).toBe(0);
  const scope = new Scope('cell');
  const leaving = fixture({ prepare: () => { scope.dispose(); return Promise.resolve(); } });
  expect(await layCellPost(leaving.look, whole, { instance: 'nine-1', root: new Group(), scope }, leaving.host)).toBe('off');
  expect(leaving.calls).toEqual([]);
  expect(leaving.systems).toEqual([]);
  expect(leaving.count.disposed).toBe(1);
});
