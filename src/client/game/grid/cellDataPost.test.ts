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
import { borrowsUniforms, lendUniforms, lentUniforms, whileUniformsLent } from '../shardfile/lentLooks';
import { layCellPost, layCellPostWhenLent, type CellPostHost } from './cellDataPost';

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

const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 0); });

test('QA 11-25 row 133: a post that composes with a lent set waits for its world to lend it, and leaves with the loan', async () => {
  // the cause: on the grid the cell's post is resident before the feet enter, and its world lends `nine-shared` only then
  const early = fixture({ prepare: () => { lentUniforms('nine-row133'); return Promise.resolve(); } });
  await expect(layCellPost(early.look, whole, { instance: 'nine-1', root: new Group(), scope: new Scope('cell') }, early.host)).rejects.toThrow('No lent uniforms nine-row133');

  const reads: unknown[] = [], made: Fixture[] = [], warned: unknown[] = [];
  const next = (): Fixture => { const f = fixture({ prepare: () => { reads.push(lentUniforms('nine-row133')['uTime']?.value); return Promise.resolve(); } }); made.push(f); return f; };
  const first = next(), cell = new Scope('cell'), root = new Group(), owners: Scope[] = [];
  const lay = (look: LookStrategy, owner: Scope): Promise<'on' | 'off'> => {
    owners.push(owner);
    return layCellPost(look, whole, { instance: 'nine-1', root, scope: owner }, made.find(f => f.look === look)?.host ?? first.host);
  };
  const make = (): Promise<LookStrategy> => Promise.resolve(borrowsUniforms(next().look, 'nine-row133'));
  expect(await layCellPostWhenLent(borrowsUniforms(first.look, 'nine-row133'), make, lay, cell, error => { warned.push(error); })).toBe('on');
  await settle();
  expect(first.calls, 'nothing composes before the loan').toEqual([]);

  const stay = new Scope('grid.data-plan.nine-1');
  lendUniforms(stay, 'nine-row133', { uTime: { value: 1 } });
  await settle();
  expect(first.calls).toEqual(['contribute nine-1 {"whole":true}', 'composite nine-1 chain']);
  expect(reads).toEqual([1]);
  expect(owners[0]?.belongsTo(cell)).toBe(true);

  // the feet leave: the world's loan ends, and the post with it; the cell stays resident
  stay.dispose();
  expect(first.calls.slice(2).sort()).toEqual(['uncomposite', 'uncontribute']);
  expect(first.count.disposed).toBe(1);

  // the feet come back: a new loan, a look built again for it
  const back = new Scope('grid.data-plan.nine-1');
  lendUniforms(back, 'nine-row133', { uTime: { value: 2 } });
  await settle();
  expect(made).toHaveLength(2);
  expect(made[1]?.calls).toEqual(['contribute nine-1 {"whole":true}', 'composite nine-1 chain']);
  expect(reads).toEqual([1, 2]);

  // the cell leaves: its post goes, and a later loan lays nothing
  cell.dispose();
  expect(made[1]?.count.disposed).toBe(1);
  lendUniforms(new Scope('late'), 'nine-row133', { uTime: { value: 3 } });
  await settle();
  expect(made).toHaveLength(2);
  expect(warned).toEqual([]);
  back.dispose();
});

test('QA 11-25 row 133: a post that borrows nothing is laid at once, and one whose cell left first is freed unlaid', async () => {
  const plain = fixture(), cell = new Scope('cell');
  expect(await layCellPostWhenLent(plain.look, () => Promise.reject(new Error('never built again')),
    (look, owner) => layCellPost(look, whole, { instance: 'nine-1', root: new Group(), scope: owner }, plain.host), cell, () => undefined)).toBe('on');
  expect(plain.calls).toEqual(['contribute nine-1 {"whole":true}', 'composite nine-1 chain']);
  const gone = fixture(), left = new Scope('cell');
  left.dispose();
  expect(await layCellPostWhenLent(borrowsUniforms(gone.look, 'nine-row133'), () => Promise.reject(new Error('never')), () => Promise.resolve('on'), left, () => undefined)).toBe('off');
  expect(gone.count.disposed).toBe(1);
});

test('QA 11-25 row 133: a newer loan replaces the borrowed one, and the older is borrowed again when the newer ends', async () => {
  const owner = new Scope('borrower'), seen: string[] = [];
  const a = new Scope('a'); lendUniforms(a, 'row133-set', { uName: { value: 'a' } });
  whileUniformsLent('row133-set', owner, loan => {
    const name = String(lentUniforms('row133-set')['uName']?.value);
    seen.push(`open ${name}`); loan.onDispose(() => { seen.push(`close ${name}`); });
  });
  const b = new Scope('b'); lendUniforms(b, 'row133-set', { uName: { value: 'b' } });
  b.dispose();
  await settle();
  owner.dispose();
  a.dispose();
  expect(seen).toEqual(['open a', 'close a', 'open b', 'close b', 'open a', 'close a']);
});
