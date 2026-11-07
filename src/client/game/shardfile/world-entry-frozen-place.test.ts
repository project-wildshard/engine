import { expect, test } from 'vitest';
import { Group, Object3D } from 'three';
import { SceneHandles } from './sceneHandles';
import { WorldEntry } from './worldEntry';
import { WorldSceneWeldAssembly } from './worldSceneWeld';

/** A frozen graph that counts its restores; its root already hangs where it was frozen. */
function frozenGraph(restored: { count: number }): WorldSceneWeldAssembly {
  const graph: unknown = Object.create(WorldSceneWeldAssembly.prototype);
  if (!(graph instanceof WorldSceneWeldAssembly)) throw new Error('Expected a frozen graph');
  return Object.assign(graph, { assemble: () => { restored.count++; return Promise.resolve(new Object3D()); } });
}

test('an entry place row restores a declared frozen graph once', async () => {
  const handles = new SceneHandles(), restored = { count: 0 }, root = new Group(), deck = new Object3D();
  handles.publish('orchard.fabric', frozenGraph(restored)); handles.publish('orchard.deck', deck);
  expect(handles.frozen('orchard.fabric')).toBe(true); expect(handles.frozen('orchard.deck')).toBe(false); expect(handles.frozen('orchard.none')).toBe(false);
  const entry = WorldEntry.admit({ blocks: {
    kits: [{ kind: 'place', id: 'orchard.fabric' }, { kind: 'attach', id: 'orchard.deck', as: 'object' }],
    again: [{ kind: 'place', id: 'orchard.fabric' }],
  } }, { scenes: handles, root, tier: 'phone' });
  await entry.run('kits');
  expect(restored.count).toBe(1);
  expect(deck.parent).toBe(root);
  await expect(entry.run('again')).rejects.toThrow('placed orchard.fabric twice');
  expect(restored.count).toBe(1);
});
