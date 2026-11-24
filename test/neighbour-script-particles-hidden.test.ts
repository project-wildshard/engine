import { Object3D, Points, Vector3 } from 'three';
import { expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { ClientScriptViews } from '../src/client/game/plugin/ui';

// ZONE-ENTRY ZE3a (J352): a frozen neighbour cell draws none of its client-script particles. On the laptop's road drive
// (2026-11-15) a retired test shard's particle pool, added to its cell root visible, was drawn on the road and linked its program
// in the frame (65 ms at (211, 1402)); `neighbourLife.ts` now shows the pool only while its cell is the active one.
test('a client script view hides and shows its particle pool on request', () => {
  const root = new Object3D(), scope = new Scope('script-particles');
  try {
    const views = new ClientScriptViews({ frame: () => undefined, tick: 0 }, [{ entity: 1, object: null, anchor: (out: Vector3) => out.set(0, 0, 0),
      emitters: [{ id: 1, live: 4, colour: [1, 1, 1], size: 1, velocity: [0, 1, 0], gravity: 0 }] }], { root, scope });
    const pool = root.children.find((child): child is Points => child instanceof Points);
    expect(pool?.name).toBe('client-script-particles');
    views.show(false);
    expect(pool?.visible).toBe(false);
    views.show(true);
    expect(pool?.visible).toBe(true);
  } finally { scope.dispose(); }
});
