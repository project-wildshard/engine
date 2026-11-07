import { expect, it } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { bindWorldSceneParts, createWorldScene } from '../src/client/game/plugin/scene';
import { originalSkySceneInputs } from './fixtures/sky-scene-source';

const { mill: MILL_SCENE, routes: { SKY_ROUTE_FRAMES } } = await originalSkySceneInputs();

it('keeps mill parts borrowed under a native spinning hub', () => {
  const parts = new Map<string, Group>(MILL_SCENE.parts.map(name => { const part = new Group(); part.name = name; return [name, part]; }));
  const geometry = new BoxGeometry(), material = new MeshStandardMaterial(), texture = new Texture();
  const made = createWorldScene(MILL_SCENE.recipe, {
    geometry: () => geometry.clone(), model: () => null,
    materials: new Map([['tower', material], ['foot', material]]), textures: new Map([['ready', texture]]),
    baked: (piece, only) => {
      expect(piece).toBe('mill'); const part = parts.get(String(only?.['name']));
      if (part === undefined) throw new Error('Missing declared mill part');
      return { root: part, colliders: [] };
    },
  });
  const bound = bindWorldSceneParts(made, { hub: 'group', hubAt: 'vector' }, MILL_SCENE.bindings);
  expect(made.root.children.map(part => part.name)).toEqual(['shaft', 'far.mill.tower', 'far.mill.foot', '']);
  expect(bound.hub.children).toEqual(MILL_SCENE.parts.slice(1).map(name => parts.get(name)));
  expect(bound.hubAt.toArray()).toEqual(bound.hub.position.toArray());
  bound.hub.rotation.z = 0.25;
  expect(parts.get('frame')?.parent).toBe(bound.hub);
  expect(parts.get('shaft')?.parent).toBe(made.root);
  made.dispose(); geometry.dispose(); material.dispose(); texture.dispose();
});

it('keeps the native hub available when optional baked parts fail to load', () => {
  const made = createWorldScene(MILL_SCENE.recipe, {
    geometry: () => null, model: () => null, textures: new Map([['ready', null]]),
    baked: () => ({ root: new Group(), colliders: [] }),
  });
  const bound = bindWorldSceneParts(made, { hub: 'group', hubAt: 'vector' }, MILL_SCENE.bindings);
  expect(bound.hub.parent).toBe(made.root);
  let drawn = 0; made.root.traverse(part => { if (part instanceof Mesh) drawn++; });
  expect(drawn).toBe(0);
  expect(bound.hub.children).toHaveLength(MILL_SCENE.parts.length - 1);
  expect(bound.hub.children.every(part => part.children.length === 0)).toBe(true);
  made.dispose();
});

it('keeps the authored fallen deck under its native pivot and copies interaction anchors', () => {
  const geometry = new BoxGeometry(), material = new MeshStandardMaterial();
  const made = createWorldScene(SKY_ROUTE_FRAMES.recipe, {
    materials: new Map(SKY_ROUTE_FRAMES.recipe.scene.materials.map(row => [row.id, material])),
    geometry: () => geometry, model: () => null, baked: () => ({ root: new Group(), colliders: [] }) });
  const deck = made.parts.get('deck');
  const parts = bindWorldSceneParts(made, { fallen: 'group', winchAt: 'vector', notesAt: 'vector' }, SKY_ROUTE_FRAMES.bindings);
  expect(deck?.parent).toBe(parts.fallen);
  parts.fallen.rotation.x = 0;
  expect(deck?.children.length).toBeGreaterThan(0);
  expect(parts.fallen).toBe(made.root);
  parts.winchAt.y += 1;
  expect(parts.winchAt.y).toBe(SKY_ROUTE_FRAMES.bindings.winchAt.value[1] + 1);
  expect(parts.notesAt.toArray()).toEqual(SKY_ROUTE_FRAMES.bindings.notesAt.value);
  made.dispose(); geometry.dispose(); material.dispose();
});
