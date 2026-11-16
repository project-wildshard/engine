// @vitest-environment node
// TEMPLATE-E2E TC-E1a: a grid data cell draws every creature it spawns, not only the ones its client scripts bind. Brasscap
// binds only particles, and on staging its 12 bodies were on the wire and never drawn.
import { expect, test } from 'vitest';
import { BoxGeometry, Group, MeshLambertMaterial } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { ClientSkin } from '../shardfile/clientSkins';
import type { GridCell } from '../../../shared/game/grid/assembly';
import { combatSourceState } from '@wildshard/engine/ui/Combat';
import { NeighbourLife, type NeighbourCreature } from './neighbourLife';

const skin: ClientSkin = { id: 'look.bandit', geometry: new BoxGeometry(), bones: [{ name: 'root', parent: null, pos: [0, 0, 0] }] as ClientSkin['bones'],
  material: () => new MeshLambertMaterial(), parts: [], clips: new Map(), skeleton: 'biped', sockets: [], attackSpan: 0 };
const cell: GridCell = { instance: 'blender-template', slug: 'blender-template', cell: [-1, -1], origin: { x: -500, z: -500 } as GridCell['origin'] };
const spawn = (id: string, x: number): object => ({ id, species: 'bandit', variant: 'tin', at: [x, 0, -20], yaw: 0, scale: 1, seed: 7 });

/** A shard with two bandits and the given client script bindings; `runtime` set makes it a native cell. */
function shard(bindings: readonly object[], runtime: object | null = null): Shardfile {
  return { runtime, identity: { slug: 'blender-template', seed: 1 }, state: { shared: [], player: [] },
    clientScripts: { divisor: 2, bindings }, creatures: { spawns: [spawn('bandit.1', -10), spawn('bandit.2', 10)], groups: [], brains: [] },
    rows: { species: [{ id: 'bandit', kind: 'bandit', label: 'Bandit', dims: { bodyY: 0.9, headRadius: 0.2 }, variants: [{ id: 'tin', label: 'Tin bandit', hp: 35 }] }], looks: [{ id: 'look.bandit', species: 'bandit' }] } } as unknown as Shardfile;
}

async function admitted(source: Shardfile, rows: (id: string) => NeighbourCreature | undefined = () => undefined): Promise<{ life: NeighbourLife; root: Group; scope: Scope }> {
  const scope = new Scope('neighbour life'), life = new NeighbourLife({ scope, simulation: () => ({ host: { entities: { get: rows } } }), active: () => true }), root = new Group();
  await life.admit(cell, root, source, new Map(), (() => undefined) as never, new Map([['blender-template', Promise.resolve(new Map([['look.bandit', skin]]))]]));
  return { life, root, scope };
}

test('a data cell with no creature binding draws every spawn', async () => {
  const { life, root } = await admitted(shard([]));
  life.late(1 / 60);
  expect(life.state()).toEqual([expect.objectContaining({ instance: 'blender-template', creatures: 2, frozen: false, failed: null })]);
  expect(root.children.filter((child) => child.visible && child.name === 'neighbour-creature:look.bandit')).toHaveLength(2);
});

test('a data cell whose client lane is refused still draws its creatures', async () => {
  // a binding naming a module the cell never admitted: the lane refuses, the bodies stay
  const binding = { module: 'f'.repeat(64), entity: 1, name: 'ring', target: { kind: 'particles', id: 'ring', at: [0, 0, 0] }, reads: [], parameters: [], pose: false,
    maxOffset: 0, minScale: 1, maxScale: 1, emitters: [] };
  const { life, root } = await admitted(shard([binding]));
  life.fixed(); life.late(1 / 60);
  const [state] = life.state();
  expect(state?.creatures).toBe(2);
  expect(state?.failed).not.toBeNull();
  expect(root.children.filter((child) => child.visible)).toHaveLength(2);
});

test('a native cell draws only its script-bound creatures: its runtime draws the rest', async () => {
  const { life } = await admitted(shard([], { binds: [] }));
  expect(life.state()).toEqual([]);
});

test('a data cell creature carries a health bar that falls with its row (TC-B10)', async () => {
  // Jake, 2026-11-15, on Brasscap: "They have no health bars." The page's Combat bars read each drawn body's row hp.
  let hp = 35;
  const row = (id: string): NeighbourCreature | undefined => id === 'bandit.1' ? { position: { x: -11, y: 0, z: -20 }, yaw: 0, scale: 1, speed: 0, strafe: 0,
    alive: hp > 0, attackPhase: -1, state: 'idle', hp, flinch: 0 } : undefined;
  const { life, scope } = await admitted(shard([]), row);
  life.late(1 / 60);
  const bandit = (): ReturnType<typeof combatSourceState>['targets'][number] | undefined => combatSourceState().targets.find((a) => a.position.x === -11);
  expect(bandit()).toMatchObject({ kind: 'bandit', label: 'Tin bandit', hp: 35, maxHp: 35, alive: true, hidden: false });
  hp = 23; life.late(1 / 60);
  expect(bandit()).toMatchObject({ hp: 23, maxHp: 35 });
  expect(combatSourceState().hits).toBe(1);
  scope.dispose();
  expect(bandit()).toBeUndefined();
});
