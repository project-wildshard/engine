import { afterAll, expect, test, vi } from 'vitest';
import * as THREE from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { clientMaterials } from '../src/client/game/shardfile/clientMaterials';
import { emptyShardfile } from '../src/shared/host/author';
import type { GraphIr } from '@wildshard/format/materialGraph';

// The IR the SDK authors for graph({ model: 'toon', surface: { colour: [0.4, 0.5, 0.6] } }); sharddev proves it still does.
const TOON_IR: GraphIr = { version: 1, kind: 'material', nodes: {}, stages: { surface: { colour: [0.4, 0.5, 0.6] } }, model: 'toon' };

vi.stubGlobal('ImageBitmap', class ImageBitmap { readonly width = 0; });
afterAll(() => { vi.unstubAllGlobals(); });

test('the SDK toon graph and classic surfaces follow the catalogue day clock in place', async () => {
  const source = emptyShardfile({ slug: 'day-fixture', name: 'Day', author: 'Test', seed: 1, revision: 1 });
  source.look.materials['cel'] = { family: 'graph', graph: TOON_IR };
  source.look.materials['classic'] = { family: 'toon', colour: [1, 1, 1], vertexColours: true, faceted: true, doubleSided: true, roughness: 0.88, metalness: 0 };
  const scope = new Scope('day-toon'), renderer: unknown = Object.create(THREE.WebGLRenderer.prototype);
  if (!(renderer instanceof THREE.WebGLRenderer)) throw new Error('Missing renderer');
  Reflect.set(renderer, 'getContext', () => ({}));
  const looks = await clientMaterials(source, new Map(), renderer, scope, { graphs: true });
  try {
    const material = looks.materials.get('cel'), classic = looks.materials.get('classic');
    if (material === undefined || classic === undefined) throw new Error('Missing toon surfaces');
    // PF10 (180df449c9): graph looks draw as classic GLSL; the program binds the family's own uniform objects, so the
    // look's day clock moves every toon program in place
    if (!(material instanceof THREE.ShaderMaterial)) throw new Error('A graph look draws as a classic GLSL material');
    expect(Object.values(material.uniforms).some(u => u === looks.toon.uniforms.famToonFace)).toBe(true);
    const version = material.version, face = looks.toon.uniforms.famToonFace.value, lift = looks.toon.uniforms.famToonLift.value;
    looks.toon.set({ faceEdge: [0.2, 0.4], lift: [0.1, 0.2, 0.3] });
    looks.tick(0.5);
    expect(looks.toon.uniforms.famToonFace.value).toBe(face);
    expect(face.toArray()).toEqual([0.2, 0.4]);
    expect(lift.toArray()).toEqual([0.1, 0.2, 0.3]);
    expect(looks.toon.uniforms.famToonTime.value).toBe(0.5);
    expect(looks.materials.get('cel')).toBe(material);
    expect(material.version).toBe(version);
    expect(() => looks.toon.set({ faceEdge: [Number.NaN, 1] })).toThrow();
    expect(face.toArray()).toEqual([0.2, 0.4]);
    expect(source.look.materials['cel']).toMatchObject({ graph: { model: 'toon' } });
  } finally { scope.dispose(); }
});
