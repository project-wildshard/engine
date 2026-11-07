// The grid's tile admission holds the authority an entered page holds: Nine's look graphs declare ceilings past the author default,
// and a neighbour's admission refused them whenever a walk reached Nine's cell before its page did.
import { expect, test } from 'vitest';
import { validateGraph } from '@wildshard/format/materialGraph';
import { admittedGraphAuthority } from './clientMaterials';

const nodes = Object.fromEntries(Array.from({ length: 268 }, (_, i) => [`n${String(i)}`, { op: 'float', value: i }]));
const graph = { version: 1, kind: 'material', budget: { nodes: 300, samplers: 1, instructions: 600 }, nodes };
const refusal = (trustedBudget: boolean): readonly string[] => { const checked = validateGraph(graph, { trustedBudget }); return checked.ok ? [] : checked.errors; };

test('a shard with a runtime or a declared page keeps its declared graph ceilings', () => {
  const runtime = { runtime: {}, questHost: null } as unknown as Parameters<typeof admittedGraphAuthority>[0];
  const page = { runtime: null, questHost: { page: { version: 1 } } } as unknown as Parameters<typeof admittedGraphAuthority>[0];
  expect(admittedGraphAuthority(runtime)).toBe(true);
  expect(admittedGraphAuthority(page)).toBe(true);
  expect(refusal(true).join(' ')).not.toContain('nested nodes counted');
});

test('a data shard stays under the author default', () => {
  expect(admittedGraphAuthority({ runtime: null })).toBe(false);
  expect(refusal(false).join(' ')).toContain('budget: 268 nodes (at most 160)');
});
