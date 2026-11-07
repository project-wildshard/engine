import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Compare every original native Float64 footprint/matrix byte.
import { deepStrictEqual } from 'node:assert';
import { Frustum, Group, OrthographicCamera, PerspectiveCamera, Sphere, Vector3 } from 'three';
import { CSM } from 'three/examples/jsm/csm/CSM.js';
import { installCascadeCull } from '../src/client/engine/world/cascadeCull';
import { installCascadeCull as original } from './fixtures/cascade-cull-before';

function create(install: typeof original): { camera: PerspectiveCamera; csm: CSM } {
  const camera = new PerspectiveCamera(62, 402 / 681, .1, 800), csm = new CSM({ camera, parent: new Group(), cascades: 3,
    maxFar: 180, mode: 'practical', lightDirection: new Vector3(-1, -.7, -.3), shadowMapSize: 1024 });
  install(csm, camera); return { camera, csm };
}
function numbers(input: unknown): number[] {
  if (!Array.isArray(input)) throw new Error('Missing original hull data');
  const values: readonly unknown[] = input, out: number[] = [];
  for (const value of values) { if (typeof value !== 'number') throw new Error('Invalid original hull data'); out.push(value); }
  return out;
}

/** the footprint the current implementation drew this frame: its first `polyLength` numbers (D107 keeps the store) */
function footprint(frustum: object): number[] {
  const length: unknown = Reflect.get(frustum, 'polyLength');
  if (typeof length !== 'number') throw new Error('Missing polyLength');
  return numbers(Reflect.get(frustum, 'poly')).slice(0, length);
}

test('every original cascade footprint byte and sphere verdict survives warm buffer reuse', () => {
  const before = create(original), after = create(installCascadeCull), sphere = new Sphere();
  let footprints = 0, verdicts = 0;
  try {
    for (let frame = 0; frame < 128; frame++) {
      for (const { camera, csm } of [before, after]) {
        camera.position.set(Math.sin(frame * .17) * 400, 2 + frame % 31, Math.cos(frame * .13) * 400);
        camera.rotation.set((frame % 19 - 9) * .13, frame * .071, (frame % 7 - 3) * .01);
        camera.far = 80 + frame % 17 * 60; camera.near = .05 + frame % 5 * .07;
        camera.fov = 35 + frame % 13 * 5; camera.aspect = frame % 2 === 0 ? 402 / 681 : 1.8;
        camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
        csm.fade = frame % 2 === 0; csm.updateFrustums(); csm.update();
        for (const light of csm.lights) {
          light.shadow.normalBias = frame % 5 * .01; light.shadow.radius = frame % 4;
          light.updateMatrixWorld(true); light.target.updateMatrixWorld(true); light.shadow.updateMatrices(light);
        }
      }
      for (let cascade = 0; cascade < 3; cascade++) {
        const oldLight = before.csm.lights[cascade], newLight = after.csm.lights[cascade];
        if (oldLight === undefined || newLight === undefined) throw new Error('Missing actual native cascade');
        const old = oldLight.shadow.getFrustum(), now = newLight.shadow.getFrustum();
        const oldPoly = numbers(Reflect.get(old, 'poly')), newPoly = footprint(now);
        deepStrictEqual(new Float64Array(newPoly), new Float64Array(oldPoly)); footprints++;
        deepStrictEqual(now.planes.flatMap(plane => [...plane.normal.toArray(), plane.constant]), old.planes.flatMap(plane => [...plane.normal.toArray(), plane.constant]));
        for (let index = 0; index < 257; index++) {
          sphere.center.set((index % 17 - 8) * 43.25, (index % 13 - 6) * 17.5, (index % 19 - 9) * 41.75);
          sphere.radius = index % 9 === 0 ? 0 : (index % 11) * 2.125;
          expect(now.intersectsSphere(sphere)).toBe(old.intersectsSphere(sphere)); verdicts++;
        }
      }
    }
    expect({ footprints, verdicts }).toEqual({ footprints: 384, verdicts: 98688 });
  } finally { before.csm.remove(); before.csm.dispose(); after.csm.remove(); after.csm.dispose(); }
});


test('duplicate, collinear, empty, expanded and non-finite footprints retain the native fallback', () => {
  const before = create(original), after = create(installCascadeCull), camera = new OrthographicCamera(-20, 20, 20, -20, .1, 100);
  const box = new Frustum().setFromProjectionMatrix(camera.projectionMatrix), sphere = new Sphere(new Vector3(), 1);
  const cases = [[], [[0, 0]], [[-0, 0], [0, -0]], [[1, 1], [1, 1], [1, 1]],
    Array.from({ length: 8 }, (_, index) => [index - 4, index - 4]),
    Array.from({ length: 8 }, (_, index) => [index % 4, Math.floor(index / 4)]),
    [[Number.NaN, 0], [0, 1], [2, Number.POSITIVE_INFINITY], [3, 3]],
    Array.from({ length: 17 }, (_, index) => [Math.sin(index), Math.cos(index)]), []];
  try {
    const old = before.csm.lights[0]?.shadow.getFrustum(), now = after.csm.lights[0]?.shadow.getFrustum();
    if (old === undefined || now === undefined) throw new Error('Missing actual native cascade');
    for (const points of cases) {
      const corners = points.map(point => new Vector3(point[0], point[1], -5));
      for (const frustum of [old, now]) {
        const refresh: unknown = Reflect.get(frustum, 'refresh');
        if (typeof refresh !== 'function') throw new Error('Missing original private footprint operation');
        Reflect.apply(refresh, frustum, [box, camera, corners, .5]);
      }
      deepStrictEqual(new Float64Array(footprint(now)), new Float64Array(numbers(Reflect.get(old, 'poly'))));
      expect(now.intersectsSphere(sphere)).toBe(old.intersectsSphere(sphere));
    }
  } finally { before.csm.remove(); before.csm.dispose(); after.csm.remove(); after.csm.dispose(); }
});
