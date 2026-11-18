// ENGINE-MEMORY EM21: one compiled Rapier per page. A realm handed a module another isolate compiled instantiates it and
// gets a working Rapier, with no compile of its own.
// oxlint-disable-next-line import/no-nodejs-modules -- the test reads Rapier's binary from its package, as node's bake scripts do
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- resolves the package's binary
import { createRequire } from 'node:module';
import { expect, test, vi } from 'vitest';
import { loadRapier } from './rapier';

test('loadRapier instantiates a compiled module it is handed', async () => {
  const module = await WebAssembly.compile(readFileSync(createRequire(import.meta.url).resolve('@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm')));
  const compile = vi.spyOn(WebAssembly, 'compile');
  const R = await loadRapier(module);
  expect(compile).not.toHaveBeenCalled();
  const world = new R.World({ x: 0, y: -9.81, z: 0 }), body = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0, 10, 0));
  world.createCollider(R.ColliderDesc.ball(0.5), body);
  for (let i = 0; i < 10; i++) world.step();
  expect(body.translation().y).toBeLessThan(10);
  world.free(); compile.mockRestore();
});
