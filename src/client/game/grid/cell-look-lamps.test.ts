// @vitest-environment node
// QA 11-25 row 138: a grid cell drew none of its shard's declared look lamps. A standalone page lights them in its data look's
// compose (`dataLook.ts`), which a grid cell never runs, so once sharddev's dev page moved onto the grid path (engine
// e02a796fb) Mossgate's hut stood unlit there, as it did for every player on staging's grid page (Mossgate 16 lamps, Glowfen
// 14, Brasscap 8). `CellSceneLife` now lights the entered cell's lamps through the page pool's reserved lights.
import { expect, test } from 'vitest';
import { Group, PerspectiveCamera, PointLight, Scene, Vector3, type Object3D, type WebGLRenderer } from 'three';
import type { LookLamp } from '@wildshard/format/look-light';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { Scope } from '@wildshard/engine/app/scope';
import { LightPool } from '@wildshard/engine/fx/LightPool';
import { DESKTOP_LAMPS, PHONE_LAMPS } from '@wildshard/engine/render/lookLight';
import type { GridCell } from '../../../shared/game/grid/assembly';
import { CellSceneLife, hasCellSceneLife } from './cellSceneLife';
import { GRID_REGION_POINT_LIGHTS } from './session';

const lamp = (x: number, extra: Partial<LookLamp> = {}): LookLamp => ({ at: [x, 2, 0], colour: [1, 0.6, 0.3], intensity: 5, distance: 9, ...extra });
const cell = (instance: string, x: number): GridCell => ({ instance, slug: instance, cell: [x / 160, 0], origin: { x, z: 0 } as GridCell['origin'] });
const shard = (lamps: readonly LookLamp[]): Shardfile => ({ runtime: null, identity: { slug: 'mossgate', seed: 1 }, water: [], look: { light: { lamps } } } as unknown as Shardfile);
const noAssets = { retained: new Map<string, Uint8Array>(), read: (): Promise<Uint8Array> => Promise.reject(new Error('no read')) };
const camera = new PerspectiveCamera();

/** what three counts into every lit program: point lights shown on the camera's layers (`WebGLRenderer.projectObject`) */
function counted(scene: Scene): number {
  let count = 0;
  const walk = (node: Object3D): void => {
    if (!node.visible) return;
    if (node instanceof PointLight && node.layers.test(camera.layers)) count++;
    for (const child of node.children) walk(child);
  };
  walk(scene);
  return count;
}
/** a page render: three poses the scene, then the pool copies the shown lamps onto its reserved lights */
function render(scene: Scene): PointLight[] {
  scene.updateMatrixWorld();
  scene.onBeforeRender(undefined as unknown as WebGLRenderer, scene, camera, null as never, null as never, null as never);
  return LightPool.for(scene).group.children.filter((light): light is PointLight => light instanceof PointLight && light.intensity > 0);
}

/** a grid page with its region reserve, and these lamp cells admitted at their origins */
async function page(cells: readonly (readonly [GridCell, readonly LookLamp[]])[], active: { id: string | null }, opts: { phone?: boolean; eye?: Vector3; lookLight?: boolean } = {}) {
  const scene = new Scene(), scope = new Scope('cell look lamps');
  LightPool.for(scene).reserve(GRID_REGION_POINT_LIGHTS);
  const life = new CellSceneLife({ scope, phone: opts.phone ?? false, feet: () => ({ x: 0, y: 0, z: 0 }), active: (id) => id === active.id, lights: LightPool.for(scene),
    eye: (out) => out.copy(opts.eye ?? new Vector3()), lookLight: () => opts.lookLight ?? true });
  for (const [at, lamps] of cells) {
    const root = new Group(); root.position.set(at.origin.x, 0, at.origin.z); scene.add(root);
    await life.admit(at, root, shard(lamps), noAssets, { materials: new Map(), swings: undefined });
  }
  return { scene, life, scope };
}

test('a data cell that declares only look lamps has scene life', () => {
  expect(hasCellSceneLife(shard([lamp(0)]))).toBe(true);
  expect(hasCellSceneLife(shard([]))).toBe(false);
});

test('the entered cell lights its declared lamps where its author put them, in its colour, reach and strength', async () => {
  const active: { id: string | null } = { id: 'mossgate' };
  const { scene, life, scope } = await page([[cell('mossgate', 320), [lamp(-4), lamp(2, { decay: 1.5 })]]], active);
  life.late(1 / 60);
  const lit = render(scene);
  expect(lit.map((light) => light.getWorldPosition(new Vector3()).toArray())).toEqual([[316, 2, 0], [322, 2, 0]]);
  expect(lit.map((light) => [light.intensity, light.distance, light.decay])).toEqual([[5, 9, 2], [5, 9, 1.5]]);
  expect(lit[0]?.color.toArray().map((v) => Number(v.toFixed(3)))).toEqual([1, 0.6, 0.3]);
  expect(life.state()[0]).toMatchObject({ lampsDeclared: 2, lamps: 2, lampsLit: 2, live: true });
  scope.dispose();
  expect(render(scene)).toHaveLength(0);
});

test('leaving and entering lights and darkens the lamps without moving the page\'s light count', async () => {
  const active: { id: string | null } = { id: 'road' };
  const { scene, life } = await page([[cell('mossgate', 320), [lamp(0), lamp(3), lamp(6)]]], active);
  const before = counted(scene);
  expect(before).toBe(GRID_REGION_POINT_LIGHTS);
  life.late(1 / 60);
  expect(render(scene)).toHaveLength(0);
  active.id = 'mossgate'; life.late(1 / 60);
  expect(render(scene)).toHaveLength(3);
  expect(counted(scene)).toBe(before);
  active.id = 'road'; life.late(1 / 60);
  expect(render(scene)).toHaveLength(0);
  expect(counted(scene)).toBe(before);
});

test('a neighbour cell\'s lamps stay dark: only the cell you stand in lights', async () => {
  const { scene, life } = await page([[cell('mossgate', 320), [lamp(0)]], [cell('glowfen', 480), [lamp(0), lamp(1)]]], { id: 'glowfen' });
  life.late(1 / 60);
  expect(render(scene).map((light) => light.getWorldPosition(new Vector3()).x)).toEqual([480, 481]);
});

test('a crowded look lights the lamps nearest the camera, as many as the reserve holds on desktop, the phone\'s four on a phone', async () => {
  const street = Array.from({ length: 16 }, (_, i) => lamp(i * 4));
  const desktop = await page([[cell('mossgate', 320), street]], { id: 'mossgate' }, { eye: new Vector3(320 + 40, 2, 0) });
  desktop.life.late(1 / 60);
  const xs = render(desktop.scene).map((light) => light.getWorldPosition(new Vector3()).x - 320).sort((a, b) => a - b);
  expect(xs).toEqual([32, 36, 40, 44, 48].slice(0, Math.min(DESKTOP_LAMPS, GRID_REGION_POINT_LIGHTS)));
  const phone = await page([[cell('mossgate', 320), street]], { id: 'mossgate' }, { eye: new Vector3(320, 2, 0), phone: true });
  phone.life.late(1 / 60);
  expect(render(phone.scene)).toHaveLength(Math.min(PHONE_LAMPS, GRID_REGION_POINT_LIGHTS));
});

test('a flickering lamp flickers on the grid as on its own page', async () => {
  const { scene, life } = await page([[cell('mossgate', 320), [lamp(0, { flicker: { amount: 0.4, rate: 2 } })]]], { id: 'mossgate' });
  const seen = new Set<number>();
  for (let i = 0; i < 30; i++) { life.late(1 / 30); seen.add(Number(render(scene)[0]?.intensity.toFixed(3))); }
  expect(seen.size).toBeGreaterThan(5);
});

test('with Settings ▸ Debug ▸ Look light off, a cell draws as one that declares no lamps', async () => {
  const { scene, life } = await page([[cell('mossgate', 320), [lamp(0)]]], { id: 'mossgate' }, { lookLight: false });
  life.late(1 / 60);
  expect(render(scene)).toHaveLength(0);
  expect(life.state()[0]).toMatchObject({ lampsDeclared: 1, lamps: 0, lampsLit: 0 });
});
