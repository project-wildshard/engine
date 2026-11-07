// @vitest-environment happy-dom
import { beforeEach, expect, test, vi } from 'vitest';
import { Group, PerspectiveCamera, Scene, Vector3 } from 'three';
import { ItemPickup } from './WeaponPickup';
import type { Interactable } from '../../../shared/engine/world/interact/types';
import { mockCanvas } from '@wildshard/engine/test/weaponParity';

class GuardedPickup extends ItemPickup {
  declare readonly interactable: Interactable;
  blocked = true;
  readonly denied = vi.fn<() => void>();
  constructor() {
    super({ scene: new Scene(), item: new Group(), position: new Vector3(), radius: 2.6, prompt: 'Take', random: () => 0.5 });
    const base = this.interactable, blocked = (): boolean => this.blocked, denied = (): void => { this.denied(); };
    this.interactable = { position: base.position,
      get radius() { return blocked() ? Math.min(base.radius, 1.4) : base.radius; },
      get weak() { return blocked(); },
      get label() { return blocked() ? 'Guarded' : base.label; },
      onInteract: () => { if (blocked()) denied(); else base.onInteract(); },
    };
  }
}

beforeEach(mockCanvas);

test('guarded prompt preserves orb proximity and shared take/disposal state', () => {
  const drop = new GuardedPickup(), camera = new PerspectiveCamera(), near = vi.fn<(inside: boolean) => void>(), taken = vi.fn<() => void>();
  drop.onNear = near; drop.onPickup = taken;
  camera.position.copy(drop.interactable.position).add(new Vector3(2, 0, 0)); camera.updateMatrixWorld();
  drop.update(0.016, 1, undefined, camera);
  expect(near).toHaveBeenCalledWith(true);
  expect(drop.interactable.radius).toBe(1.4);
  expect(drop.interactable.weak).toBe(true);
  drop.interactable.onInteract();
  expect(drop.denied).toHaveBeenCalledOnce(); expect(drop.taken).toBe(false);
  drop.prompt = 'Take iron sword';
  expect(drop.interactable.label).toBe('Guarded');
  drop.blocked = false;
  expect(drop.interactable.label).toBe('Take iron sword');
  drop.interactable.onInteract(); drop.interactable.onInteract();
  expect(taken).toHaveBeenCalledOnce(); expect(drop.taken).toBe(true);
  expect(drop.interactable.radius).toBe(0); expect(near).toHaveBeenLastCalledWith(false);
  drop.dispose(); drop.dispose();
  expect(taken).toHaveBeenCalledOnce();
});
