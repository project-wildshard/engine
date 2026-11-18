// @vitest-environment node
// SHARD-SOURCE SS-GP6: a grid data cell's look graphs. A one-shard page binds its material graphs to the frame owner's hour
// and its live state fields (`client.ts` `graphs.bind`) and ticks its presentation each frame; the grid's tile admission
// (`session.ts`) compiled a data cell's look and did neither, so a graph param bound to a state field stood at the field's
// default on the grid, and a day-bound one at the hour it compiled. While the feet stand in the copy its look now reads the
// cell's fields off its wire and ticks; mid-crossing (the wire another cell's) it holds the last value it read.
import { ShaderMaterial } from 'three';
import { afterEach, expect, test } from 'vitest';
import type { SystemSpec } from '@wildshard/engine/app/systems';
import { Scope } from '@wildshard/engine/app/scope';
import { classicLookCompiler } from './fixtures/classicLookCompiler';
import { emptyShardfile } from '../src/shared/host/author';
import { clientGraphs } from '../src/client/game/shardfile/clientGraphs';
import { wirePage } from '../src/client/game/shardfile/wirePage';
import { cellFieldReader, cellLooks, followCellLooks, installCellLooks, offerCellLook } from '../src/client/game/grid/dataCellLooks';

const source = emptyShardfile({ slug: 'storm-copy', name: 'Storm', author: 'Test', seed: 1, revision: 1 });
source.state.shared = [{ id: 120, name: 'storm', type: 'f64', privacy: 'public', default: 0, min: 0, max: 1 },
  { id: 121, name: 'secret', type: 'f64', privacy: 'host', default: 0.5, min: 0, max: 1 }];
const graph = { version: 1, kind: 'material', model: 'unlit', params: { storm: { type: 'float', value: 0, min: 0, max: 1, bind: { state: 'shared.storm' } } },
  nodes: { storm: { op: 'param', param: 'storm' } }, stages: { surface: { colour: [1, 1, 1], alpha: 'storm' } } } as const;
const rowOf = wirePage.row.bind(wirePage);
afterEach(() => { wirePage.row = rowOf; cellLooks.clear(); });

function storm(): { graphs: ReturnType<typeof clientGraphs>; uniform: () => unknown } {
  const graphs = clientGraphs(source, { compiler: classicLookCompiler(), fallback: () => { throw new Error('Unexpected fallback'); }, textures: () => { throw new Error('Unexpected texture'); } });
  const material = graphs.compile({ family: 'graph', graph } as never);
  if (!(material instanceof ShaderMaterial)) throw new Error('Missing graph material');
  return { graphs, uniform: () => material.uniforms['wsP_storm']?.value };
}

test('a compiled cell look nobody binds or ticks stands at its field\'s default (the grid before SS-GP6)', () => {
  const { graphs, uniform } = storm();
  wirePage.row = (name) => (name === 'storm' ? 0.7 : undefined);
  expect(uniform()).toBe(0);
  // what session.ts's admission did with it: nothing more. A one-shard page binds it and ticks it, and then it follows.
  graphs.bind({ state: cellFieldReader(source) }); graphs.tick(1 / 60);
  expect(uniform()).toBeCloseTo(0.7, 6);
});

test('an entered copy\'s look follows its cell\'s field off the wire, and holds it mid-crossing (SS-GP6)', () => {
  const { graphs, uniform } = storm();
  const stay = new Scope('grid-looks-stay'), systems: SystemSpec[] = [];
  let value = 0.7, here = true;
  wirePage.row = (name) => (name === 'storm' ? value : name === 'secret' ? 0.9 : undefined);
  installCellLooks({ source, bind: graphs.bind, tick: graphs.tick }, stay, () => here, { system: spec => { systems.push(spec); }, hour: () => 18 });
  const frame = (): void => { for (const system of systems) system.run(1 / 60, 0); };
  frame(); expect(uniform()).toBeCloseTo(0.7, 6);
  value = 0.2; frame(); expect(uniform()).toBeCloseTo(0.2, 6);
  here = false; value = 0.9; frame(); expect(uniform()).toBeCloseTo(0.2, 6); // another cell's wire: hold
  here = true; frame(); expect(uniform()).toBeCloseTo(0.9, 6);
  expect(cellFieldReader(source)('shared', 'secret')).toBeUndefined(); // a host field never reads off the wire, as on a one-shard page
  stay.dispose();
});

test('the stay installs on entering a data cell whose look admits before or after the feet, and goes on leaving', () => {
  const { graphs } = storm();
  const enters: ((cell: { instance: string }) => void)[] = [], leaves: (() => void)[] = [];
  const page = new Scope('grid-looks-page'), stays: string[] = [];
  const events = { onEnter: (fn: (cell: { instance: string }) => void) => { enters.push(fn); return () => undefined; }, onLeave: (fn: () => void) => { leaves.push(fn); return () => undefined; } };
  const install = (instance: string, stay: Scope): void => { stays.push(instance); stay.onDispose(() => { stays.push(`-${instance}`); }); };
  followCellLooks(page, events, (instance) => instance !== 'runtime-cell', install);
  offerCellLook('copy-a', { source, bind: graphs.bind, tick: graphs.tick });
  for (const enter of enters) enter({ instance: 'copy-a' }); // admitted first, entered after
  for (const leave of leaves) leave();
  for (const enter of enters) enter({ instance: 'runtime-cell' }); // a runtime cell's own world binds its look
  for (const enter of enters) enter({ instance: 'copy-b' }); // entered before its look admits
  offerCellLook('copy-b', { source, bind: graphs.bind, tick: graphs.tick });
  expect(stays).toEqual(['copy-a', '-copy-a', 'copy-b']);
  page.dispose();
  expect(stays).toEqual(['copy-a', '-copy-a', 'copy-b', '-copy-b']);
});
