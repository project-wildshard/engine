import {SHAPE_BYTES} from './fixtures/nalatiShapes';
import { parse } from 'valibot';
import { MountedSpecimenSeatSchema } from '@wildshard/format/mountedSpecimenRows';
import { expect, test } from 'vitest';
import { Bone, Skeleton } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { SeatedFigure } from '../src/client/game/riding/seatedFigure';
import type { Animal } from '../src/client/engine/entities/AnimalView';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { MOUNTED_FIGURE as rows } from './fixtures/nalati-poi-paint-original';
import { installWorldFixture } from './fixtures/worldSetup';

await installWorldFixture();

test('a marsh ferryman binds different joints and cue clocks without another channel program', () => {
  const scope = new Scope('ferryman'), oar = rows.shapes.find(shape => shape.key === 'shepherd-arm');
  if (oar === undefined) throw new Error('Missing arm shape');
  const profile = { ...rows, mount: 'waist', figure: { ...rows.figure, root: 'ferryman', nodes: [
    { kind: 'group', id: 'ferryman', children: ['oar'] }, { kind: 'mesh', id: 'oar', geometry: 'oar', material: 'rider', missing: 'empty' },
  ] }, shapes: [{ ...oar, key: 'oar' }], gestures: [{ cue: 'rowing', clock: 'strokeT', duration: .45 }], clips: JSON.parse(JSON.stringify(rows.clips).replaceAll('"rider"', '"ferryman"').replaceAll('"arm"', '"oar"').replaceAll('crackT', 'strokeT')) as unknown };
  const figure = new SeatedFigure(parse(MountedSpecimenSeatSchema,profile), scope,SHAPE_BYTES);
  const joint = new Bone(); joint.name = 'waist';
  figure.attach(legacyDouble<Animal>({ mesh: legacyDouble<Animal['mesh']>({ skeleton: new Skeleton([joint]) }) }));
  expect(joint.children).toContain(figure.root);
  figure.update(.1, [], 10); expect(figure.root.rotation.x).toBeCloseTo(.084);
  const arm = figure.root.children[0]; if (arm === undefined) throw new Error('Missing oar');
  expect(arm.rotation.x).toBe(-.2);
  figure.update(0, ['rowing'], 0); let time = 0;
  for (const dt of [.05, .1, .06, .1, .2]) {
    time += dt; figure.update(dt, [], 0); const u = time / .45;
    const angle = u < .45 ? -.2 - 2.4 * u / .45 : -2.6 + 3.2 * Math.min(1, (u - .45) / .3);
    expect(arm.rotation.x).toBeCloseTo(angle, 12);
  }
  figure.update(.01, [], 0); expect(arm.rotation.x).toBe(-.2);
  expect(() => figure.attach(legacyDouble<Animal>({ mesh: legacyDouble<Animal['mesh']>({ skeleton: new Skeleton() }) }))).toThrow('joint');
  scope.dispose();
});
