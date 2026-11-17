// @vitest-environment node
// Meta SHARD-SOURCE SS-SHIPb: on staging v0.1.33 Mossgate's lanterns hung still and its yard drew no detail grass, while
// the devserver page swung and drew both. A grid cell never runs `ShardfileClient.world()`, which installs them; the
// session's tile admission compiled the swing uniforms and nothing wrote them. `CellSceneLife` is the grid's half.
import { afterEach, expect, test } from 'vitest';
import { Group } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { createSwingUniforms, type SwingRow } from '@wildshard/engine/world/swings';
import { windUniforms } from '@wildshard/engine/world/wind';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { GridCell } from '../../../shared/game/grid/assembly';
import { CellSceneLife, hasCellSceneLife } from './cellSceneLife';

const lantern: SwingRow = { pivot: [-8, 2.6, 3.3], length: 0.7, rate: 0.6, amount: 0.08, reach: 0.35 };
const cell = (instance: string, x: number): GridCell => ({ instance, slug: 'mossgate', cell: [x / 160, 0], origin: { x, z: 0 } as GridCell['origin'] });
const shard = (over: Partial<{ runtime: object | null; swings: readonly SwingRow[] }> = {}): Shardfile => ({
  runtime: over.runtime ?? null, identity: { slug: 'mossgate', seed: 1 }, water: [],
  look: { light: { swings: over.swings ?? [lantern] } },
} as unknown as Shardfile);
const noAssets = { retained: new Map<string, Uint8Array>(), read: (): Promise<Uint8Array> => Promise.reject(new Error('no read')) };
const gust = windUniforms.uGust.value;
afterEach(() => { windUniforms.uGust.value = gust; });

/** A page with the given cells admitted at their origins; `feet` and `active` are the session's. */
async function page(cells: readonly GridCell[], feet: { x: number; y: number; z: number }, active: { id: string | null }) {
  const scope = new Scope('cell scene life'), swings = createSwingUniforms();
  const life = new CellSceneLife({ scope, phone: false, feet: () => feet, active: (id) => id === active.id });
  for (const at of cells) {
    const root = new Group(); root.position.set(at.origin.x, 0, at.origin.z);
    await life.admit(at, root, shard(), noAssets, { materials: new Map(), swings });
  }
  return { life, swings, scope };
}
const leaned = (swings: ReturnType<typeof createSwingUniforms>): number => { const q = swings.wsSwingTilt.value[0]; return q === undefined ? 0 : Math.hypot(q.x, q.y, q.z); };

test('the entered data cell writes its swings: its pivot in world metres, a lean in the wind', async () => {
  windUniforms.uGust.value = 1;
  const { life, swings } = await page([cell('mossgate', 320)], { x: 300, y: 0, z: 0 }, { id: 'mossgate' });
  for (let i = 0; i < 60 * 5; i++) life.late(1 / 60);
  expect(swings.wsSwingPivot.value[0]?.toArray()).toEqual([312, 2.6, 3.3, 1]);
  expect(leaned(swings)).toBeGreaterThan(0.005);
  expect(life.state()).toEqual([{ instance: 'mossgate', layers: 0, swings: 1, splash: false, live: true }]);
});

test('walking into a lantern kicks it, and it settles', async () => {
  windUniforms.uGust.value = 0;
  const feet = { x: 320 - 8 - 2, y: 0.8, z: 3.3 };
  const { life, swings } = await page([cell('mossgate', 320)], feet, { id: 'mossgate' });
  for (let i = 0; i < 30; i++) life.late(1 / 60);
  const calm = leaned(swings);
  // walk 4 m along +x through the bob at 4 m/s
  for (let i = 0; i < 60; i++) { feet.x += 4 / 60; life.late(1 / 60); }
  const kicked = leaned(swings);
  expect(kicked).toBeGreaterThan(calm + 0.02);
  feet.x += 10;
  for (let i = 0; i < 60 * 30; i++) life.late(1 / 60);
  expect(leaned(swings)).toBeLessThan(kicked / 4);
});

test('leaving the cell stills its swings; a neighbour cell never steps them', async () => {
  windUniforms.uGust.value = 1;
  const active: { id: string | null } = { id: 'mossgate' };
  const { life, swings } = await page([cell('mossgate', 320)], { x: 300, y: 0, z: 0 }, active);
  for (let i = 0; i < 60 * 5; i++) life.late(1 / 60);
  expect(leaned(swings)).toBeGreaterThan(0.005);
  active.id = 'road';
  life.late(1 / 60);
  expect(leaned(swings)).toBe(0);
  for (let i = 0; i < 60; i++) life.late(1 / 60);
  expect(leaned(swings)).toBe(0);
  expect(life.state()[0]?.live).toBe(false);
});

test('two copies of one product share its uniforms, so their swings hold still', async () => {
  windUniforms.uGust.value = 1;
  const { life, swings } = await page([cell('mossgate', 320), cell('mossgate-2', 480)], { x: 300, y: 0, z: 0 }, { id: 'mossgate' });
  for (let i = 0; i < 60 * 5; i++) life.late(1 / 60);
  expect(leaned(swings)).toBe(0);
});

test('a runtime cell or a cell with nothing to sway has no scene life', () => {
  expect(hasCellSceneLife(shard())).toBe(true);
  expect(hasCellSceneLife(shard({ runtime: { version: 1 } }))).toBe(false);
  expect(hasCellSceneLife(shard({ swings: [] }))).toBe(false);
});
