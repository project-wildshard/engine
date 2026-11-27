import {describe, expect, it} from 'vitest';
import {BARK_LAYERS, barkLayers, treeSetUrls} from '../src/client/engine/world/forest/treeSet';

// STANDALONE-SHARDFILES SF5: a zone's trees and their bark come from the zone's own folders, never the engine's
// `/assets/models` or `/assets/tex`, which a page no longer carries for a zone.
describe('tree set URLs', () => {
  it('reads a zone set and its bark from the zone folder', () => {
    expect(treeSetUrls('/assets/pine-hollow/models/pine-hollow-trees/').glb).toBe('/assets/pine-hollow/models/pine-hollow-trees/trees.glb');
    expect(barkLayers('/assets/pine-hollow/models/pine-hollow-trees')).toEqual(BARK_LAYERS.map(id => `/assets/pine-hollow/tex/${id}`));
  });
  it('keeps an engine-wide set on the engine paths', () => {
    expect(treeSetUrls('pine-hollow-trees').cardsAlbedo).toBe('/assets/models/pine-hollow-trees/cards-albedo.png');
    expect(barkLayers('pine-hollow-trees')).toEqual([...BARK_LAYERS]);
  });
});
