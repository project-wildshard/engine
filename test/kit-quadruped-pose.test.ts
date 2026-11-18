import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { bindFlatTerrain } from '../src/test/engine/terrain';
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

const knees = ['FL_carpus', 'FR_carpus', 'BL_stifle', 'BR_stifle'];

test.each([
  { gait: 'walk', speed: 1.3, swingPeaks: [.56, .06, .81, .31] },
  { gait: 'trot', speed: 4, swingPeaks: [.74, .24, .24, .74] },
  { gait: 'gallop', speed: 6, swingPeaks: [.13, 0, .68, .56] },
])('the actual clipless GLB reaches the $gait swing peaks at the expected phases', async ({ speed, swingPeaks }) => {
  const f = await kitView(clipless, 'quadruped', dims, await rapier);
  try {
    f.actor.speed = speed;
    f.actor.state = 'flee';
    f.actor.levelGround = true;
    const peaks = knees.map(() => ({ phase: 0, flex: 0 }));
    for (let frame = 0; frame < 360; frame++) {
      f.view.update(1 / 60, frame / 60, true);
      if (frame < 120) continue;
      for (const [index, joint] of knees.entries()) {
        const peak = peaks[index];
        const flex = f.rig.bones[joint]?.rotation.x ?? 0;
        if (peak !== undefined && flex > peak.flex) {
          peak.flex = flex;
          peak.phase = f.view.gaitPhase;
        }
      }
    }
    for (const [index, peak] of peaks.entries()) {
      expect(peak.flex).toBeGreaterThan(.3);
      const phaseError = Math.abs(peak.phase - (swingPeaks[index] ?? NaN));
      expect(Math.min(phaseError, 1 - phaseError)).toBeLessThan(.05);
    }
  } finally { f.dispose(); }
});

test('the actual clipless GLB grazes and then raises its head on return to idle', async () => {
  const f = await kitView(clipless, 'quadruped', dims, await rapier);
  try {
    const head = f.rig.bones['head'];
    if (head === undefined) throw new Error('Missing canonical head');
    f.actor.levelGround = true;
    f.actor.speed = 0;
    const headHeight = (state: 'idle' | 'graze', start: number): number => {
      f.actor.state = state;
      for (let frame = 0; frame < 120; frame++) f.view.update(1 / 60, start + frame / 60, true);
      return head.getWorldPosition(new Vector3()).y;
    };
    const idleHeight = headHeight('idle', 0);
    const grazingHeight = headHeight('graze', 2);
    expect(idleHeight - grazingHeight).toBeGreaterThan(.2);
    expect(headHeight('idle', 4) - grazingHeight).toBeGreaterThan(.2);
  } finally { f.dispose(); }
});

test('the actual clipless GLB flexes only the foot over an uneven patch', async () => {
  const f = await kitView(clipless, 'quadruped', dims, await rapier);
  const terrainQueries: number[] = [];
  const releaseTerrain = bindFlatTerrain({ heightAt: (x, z) => {
    const height = Math.hypot(x - .23, z - .47) < .1 ? .16 : 0;
    terrainQueries.push(height);
    return height;
  } });
  try {
    f.view.place(0, 0, 0, 0);
    f.actor.state = 'idle';
    const kneeFlex = (levelGround: boolean): number[] => {
      f.actor.levelGround = levelGround;
      for (let frame = 0; frame < 120; frame++) {
        if (frame % 6 === 0) f.view.sampleTerrain();
        f.view.update(1 / 60, frame / 60, true);
      }
      return knees.map(joint => f.rig.bones[joint]?.rotation.x ?? 0);
    };
    const flat = kneeFlex(true);
    expect(terrainQueries).toHaveLength(0);
    const rough = kneeFlex(false);
    expect(terrainQueries).toContain(.16);
    expect((rough[0] ?? 0) - (flat[0] ?? 0)).toBeCloseTo(1.6 * .16 / dims.legLen, 3);
    expect(rough.slice(1)).toEqual(flat.slice(1));
    const reset = kneeFlex(true);
    expect(reset[0]).toBeCloseTo(flat[0] ?? NaN, 3);
  } finally { releaseTerrain(); f.dispose(); }
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
