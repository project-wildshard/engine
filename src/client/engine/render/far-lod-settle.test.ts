// meta DRIFTWOOD-FPS DF9 (mini-dfload): the far copies build under the loading card, not after control.
import { afterEach, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { FAR_LEVELS, SETTLE_BUDGET_MS, farCopiesPending, farLodReport, resetFarLod, settleFarCopies } from './farLod';

afterEach(() => { resetFarLod(); });

/** a wide static ground: an n by n grid of `size` m quads on a gentle slope (n·n·2 triangles), offset by `lift` */
function ground(n: number, size: number, lift: number): THREE.Mesh {
  const positions: number[] = [], index: number[] = [];
  for (let x = 0; x <= n; x++) for (let z = 0; z <= n; z++) positions.push(x * size, lift + 0.002 * x * z + 0.3 * Math.sin(x * 0.7) * Math.cos(z * 0.5), z * size);
  for (let x = 0; x < n; x++) for (let z = 0; z < n; z++) {
    const a = x * (n + 1) + z, b = a + 1, c = a + n + 1, d = c + 1;
    index.push(a, b, c, c, b, d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(index);
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
}

test('after the loading step no far-copy build is pending, within the step budget', async () => {
  resetFarLod(true);
  const scene = new THREE.Scene(), mesh = ground(64, 2, 0);
  scene.add(mesh);
  // a hidden subtree is no draw the route will make: left alone
  const hidden = new THREE.Group(); hidden.visible = false; hidden.add(ground(64, 2, 5)); scene.add(hidden);
  const squares = farLodReport.squares;
  const settled = await settleFarCopies({ scene });
  expect(settled.captured).toBe(1);
  expect(settled.left).toBe(0);
  expect(farCopiesPending()).toBe(0);
  expect(settled.built).toBe((farLodReport.squares - squares) * FAR_LEVELS.length);
  expect(settled.ms).toBeLessThan(SETTLE_BUDGET_MS);
  expect(farLodReport.settleLeft).toBe(0);
});

test('the step keeps its budget and leaves the rest to the play pace', async () => {
  resetFarLod(true);
  const scene = new THREE.Scene();
  for (let i = 0; i < 3; i++) scene.add(ground(80, 1.5, 10 + i));
  const progress: [number, number][] = [];
  const settled = await settleFarCopies({ scene, budgetMs: 1, progress: (done, total) => { progress.push([done, total]); } });
  expect(settled.captured).toBe(3);
  // one 12 ms slice may be running when the budget ends; the step returns at its next look
  expect(settled.ms).toBeLessThan(200);
  expect(settled.left).toBeGreaterThan(0);
  expect(progress[0]?.[0]).toBe(0);
  await vi.waitFor(() => { expect(farCopiesPending()).toBe(0); }, { timeout: 30_000, interval: 50 });
});
