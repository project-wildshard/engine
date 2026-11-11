import {expect, test} from 'vitest';
import {bundlerSources} from '../src/cook/game/fenceReads';

// GVS G9: with pnpm's global virtual store on, a vendor asset's manifest key climbs out of the checkout into the store's
// links/ folder. It must still be keyed by its package path, or a recorded asset-source:node_modules/… identity misses.
test('a vendor asset is keyed by its package path in every install layout', () => {
  const asset = 'three/examples/textures/water.png';
  const sources = bundlerSources({
    [`node_modules/${asset}`]: {file: 'assets/root.png'},
    [`../../../../node_modules/.pnpm/three@0.186.0/node_modules/${asset}`]: {file: 'assets/classic.png'},
    [`../../../../../../../Library/pnpm/store/v10/links/@/three/0.186.0/363e1af0/node_modules/${asset}`]: {file: 'assets/mac-store.png'},
    [`../../../.local/share/pnpm/store/v10/links/@/three/0.186.0/363e1af0/node_modules/${asset}`]: {file: 'assets/linux-store.png'},
    [`/home/runner/setup-pnpm/node_modules/.bin/store/v10/links/@/three/0.186.0/363e1af0/node_modules/${asset}`]: {file: 'assets/absolute.png'},
  });
  for (const file of ['root', 'classic', 'mac-store', 'linux-store', 'absolute']) expect(sources.get(`/assets/${file}.png`)).toEqual([`node_modules/${asset}`]);
});

test('a project file keeps its project path, even inside a node_modules folder or above the project', () => {
  const sources = bundlerSources({
    'src/art/node_modules/leaf.png': {file: 'assets/leaf.png'},
    './src/art/bark.png': {file: 'assets/bark.png'},
    '../shared/art/stone.png': {file: 'assets/stone.png'},
    'src/main.ts': {file: 'assets/main.js'},
  });
  expect(sources.get('/assets/leaf.png')).toEqual(['src/art/node_modules/leaf.png']);
  expect(sources.get('/assets/bark.png')).toEqual(['src/art/bark.png']);
  expect(sources.get('/assets/stone.png')).toEqual(['../shared/art/stone.png']);
  expect(sources.has('/assets/main.js')).toBe(false);
});
