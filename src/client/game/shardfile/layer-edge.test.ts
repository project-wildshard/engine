import { expect, test } from 'vitest';
import { LOW_LAYER_EDGE } from '@wildshard/engine/core/graphicsMode';
import { layerEdge } from './worldSceneTextures';

test('phone Low prepares a layered paint array at most LOW_LAYER_EDGE on a side; every other pick keeps its declared edge', () => {
  expect(LOW_LAYER_EDGE).toBe(256);
  expect(layerEdge(512, true)).toBe(256);
  expect(layerEdge(128, true)).toBe(128);
  expect(layerEdge(512, false)).toBe(512);
  expect(layerEdge(1024, false)).toBe(1024);
});
