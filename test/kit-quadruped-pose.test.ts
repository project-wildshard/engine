import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { kitView } from './fixtures/kit-view';

const rapier = loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
const dims = { bodyY: .62, bodyHalfLen: .52, bodyRadius: .32, headRadius: .27, legLen: .55, halfWidth: .32,
  feet: [[.23, .47], [-.23, .47], [.23, -.43], [-.23, -.43]] as [number, number][] };
const clipless = new Uint8Array(readFileSync(new URL('./fixtures/kit-quadruped-clipless.glb', import.meta.url)));
const idle = new Uint8Array(readFileSync(new URL('./fixtures/kit-quadruped-idle.glb', import.meta.url))),
  walk = new Uint8Array(readFileSync(new URL('./fixtures/kit-quadruped-walk.glb', import.meta.url)));

test.each([{ label: 'clipless', bytes: clipless }, { label: 'idle body clip', bytes: idle }].flatMap(asset => [1.3, 3.2, 6].map(speed => ({ ...asset, speed }))))('actual $label canonical GLB uses native gait at speed $speed', async ({ speed, bytes }) => {
  const f = await kitView(bytes, 'quadruped', dims, await rapier);
  try {
    expect(f.definition.rig).toBe('quadruped'); expect(f.definition.rigContract?.skeleton).toBe('kit.quadruped');
    expect(f.rig.bones['earL']).toBeUndefined(); expect(f.rig.bones['belly']).toBeUndefined();
    f.actor.speed = speed; f.actor.state = 'flee'; f.actor.levelGround = true;
    const before = f.actor.snapshot(), positions: number[] = [], vertices: number[] = [];
    const joint = f.rig.mesh.skeleton.bones.findIndex(bone => bone.name === 'FL_shoulder'), indices = f.rig.mesh.geometry.getAttribute('skinIndex');
    let vertex = -1;
    for (let index = 0; index < indices.count; index++) if (indices.getX(index) === joint) { vertex = index; break; }
    expect(vertex).toBeGreaterThanOrEqual(0);
    const sample = new Vector3();
    for (let frame = 0; frame < 120; frame++) {
      f.view.update(1 / 60, frame / 60, true);
      positions.push(f.rig.bones['FL_shoulder']?.rotation.x ?? 0);
      f.rig.mesh.updateMatrixWorld(true); f.rig.mesh.skeleton.update();
      vertices.push(f.rig.mesh.getVertexPosition(vertex, sample).z);
    }
    expect(Math.max(...positions) - Math.min(...positions)).toBeGreaterThan(.1);
    expect(Math.max(...vertices) - Math.min(...vertices)).toBeGreaterThan(.02);
    expect(f.actor.snapshot()).toEqual(before);
    expect(f.loaded.clips.has('walk')).toBe(false);
  } finally { f.dispose(); }
});

test('an actual walk track overrides the native upper joint while untracked joints retain the gait', async () => {
  const f = await kitView(walk, 'quadruped', dims, await rapier);
  try {
    f.actor.speed = 3.2; f.actor.state = 'flee'; f.actor.levelGround = true;
    const lower: number[] = [];
    for (let frame = 0; frame < 120; frame++) {
      f.view.update(1 / 60, frame / 60, true);
      expect(f.rig.bones['FL_shoulder']?.rotation.x).toBeCloseTo(.4, 6);
      lower.push(f.rig.bones['FL_carpus']?.rotation.x ?? 0);
    }
    expect(Math.max(...lower) - Math.min(...lower)).toBeGreaterThan(.1);
    expect(f.rig.bones['FL_shoulder']?.position.x).toBeCloseTo(.33, 6);
    f.actor.speed = 0; f.actor.state = 'idle'; f.view.update(1 / 60, 2, true);
    expect(f.rig.bones['FL_shoulder']?.position.x).toBeCloseTo(.23, 6);
  } finally { f.dispose(); }
});

test('an admitted pose layer follows the fresh native gait without freezing or accumulating it', async () => {
  const f = await kitView(idle, 'quadruped', dims, await rapier, 1, undefined, { idle: [{ id: 'tail.offset', period: 1,
    times: [0, 1], phasePeriod: 1, phaseSteps: 0, tracks: [{ bone: 'tail', property: 'position', axis: 'x', order: 'XYZ', values: [.05, .05] }] }] });
  try {
    f.actor.speed = 3.2; f.actor.state = 'flee'; f.actor.levelGround = true;
    const leg: number[] = [];
    for (let frame = 0; frame < 120; frame++) {
      f.view.update(1 / 60, frame / 60, true);
      expect(f.rig.bones['tail']?.position.x).toBeCloseTo(.05, 6);
      leg.push(f.rig.bones['FL_shoulder']?.rotation.x ?? 0);
    }
    expect(Math.max(...leg) - Math.min(...leg)).toBeGreaterThan(.1);
  } finally { f.dispose(); }
});
