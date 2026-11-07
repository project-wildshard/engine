import { expect, test, vi } from 'vitest';
import { Scope } from '../app/scope';
import { Physics } from './Physics';
import { loadRapier } from './rapier';
import { TransferWalls } from './transferWalls';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';

const wasm = new URL('../../../../node_modules/@dimforge/rapier3d-simd/rapier_wasm3d_bg.wasm', import.meta.url);

test('every sync resolves the current fences once in order and enables them', async () => {
  const R = await loadRapier(Uint8Array.from(fixtureBytes(wasm))), scope = new Scope('transfer-sync'), physics = new Physics(R);
  const walls = new TransferWalls(() => physics, [{ x: 0, z: 0 }], .38, 'entry', scope);
  try {
    const handles = walls.snapshot();
    for (const handle of handles) physics.world.getCollider(handle).setEnabled(false);
    const get = vi.spyOn(physics.world.colliders, 'get');
    try {
      walls.sync();
      expect(get.mock.calls).toEqual(handles.map(handle => [handle]));
      get.mockClear();
      walls.sync();
      expect(get.mock.calls).toEqual(handles.map(handle => [handle]));
    } finally { get.mockRestore(); }
    expect(handles.every(handle => physics.world.getCollider(handle).isEnabled())).toBe(true);
  } finally { scope.dispose(); physics.dispose(); }
});

test('restore resolves replacement-world colliders without retaining the old wrappers', async () => {
  const R = await loadRapier(Uint8Array.from(fixtureBytes(wasm))), scope = new Scope('transfer-restore'), original = new Physics(R);
  let current = original;
  const walls = new TransferWalls(() => current, [{ x: 0, z: 0 }], .38, 'exit', scope);
  const handles = walls.snapshot(), restored = new Physics(R, original.world.takeSnapshot());
  try {
    for (const handle of handles) {
      original.world.getCollider(handle).setEnabled(false);
      restored.world.getCollider(handle).setEnabled(false);
    }
    current = restored; walls.restore(handles); walls.sync();
    expect(handles.every(handle => restored.world.getCollider(handle).isEnabled())).toBe(true);
    expect(handles.every(handle => !original.world.getCollider(handle).isEnabled())).toBe(true);
  } finally { scope.dispose(); restored.dispose(); original.dispose(); }
});

test('a missing fence refuses at its original slot before enabling the remaining suffix', async () => {
  const R = await loadRapier(Uint8Array.from(fixtureBytes(wasm))), scope = new Scope('transfer-missing'), physics = new Physics(R);
  const walls = new TransferWalls(() => physics, [{ x: 0, z: 0 }], .38, 'entry', scope);
  try {
    const handles = walls.snapshot(), middle = Math.floor(handles.length / 2), missing = handles[middle];
    if (missing === undefined) throw new Error('Missing fixture fence');
    for (const handle of handles) physics.world.getCollider(handle).setEnabled(false);
    physics.world.removeCollider(physics.world.getCollider(missing), false);
    expect(() => walls.sync()).toThrow('Missing transfer fence collider');
    for (let index = 0; index < handles.length; index++) {
      const handle = handles[index];
      if (handle === undefined || index === middle) continue;
      expect(physics.world.getCollider(handle).isEnabled()).toBe(index < middle);
    }
    walls.dispose();
    const get = vi.spyOn(physics.world.colliders, 'get');
    try { walls.sync(); expect(get).not.toHaveBeenCalled(); } finally { get.mockRestore(); }
  } finally { scope.dispose(); physics.dispose(); }
});
