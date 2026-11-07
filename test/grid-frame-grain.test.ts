import { expect, test } from 'vitest';
import { BrightnessContrastEffect, EffectPass, HueSaturationEffect, type EffectComposer } from 'postprocessing';
import { PerspectiveCamera, Scene } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { GradeEffect } from '@wildshard/engine/core/Grade';
import { RegionCinematic } from '../src/client/engine/render/regionCinematic';
import { CINEMATIC_FX } from '@wildshard/engine/render/look';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import { GridFrame, passEffects } from '../src/client/game/grid/frame';
import type { RegionChain } from '../src/client/game/grid/frameLook';

const chain: RegionChain = {
  grade: { saturation: 1, brightness: 0, contrast: 0, shadowTint: [1, 1, 1], highTint: [1, 1, 1],
    lift: [0, 0, 0], gain: [1, 1, 1], gamma: 1 },
  look: { curve: 0, vibrance: 0 }, lut: () => null,
  post: { kind: 'cinematic', bloomIntensity: 0, bloomThreshold: 1, bloomSmoothing: 1, vignette: 0,
    rays: 0, ao: false, volumetric: { strength: .5, sunColor: [1, 1, 1] } },
};

test('G725: carried grain ends at the cell boundary and never stacks on re-entry', () => {
  const scope = new Scope('grain-boundary'), scene = new Scene(), camera = new PerspectiveCamera();
  const saturation = new HueSaturationEffect(), contrast = new BrightnessContrastEffect(), grade = new GradeEffect();
  const pass = new EffectPass(camera, saturation, contrast, grade);
  const composer = legacyDouble<EffectComposer>({ passes: [pass] });
  const cinematic = new RegionCinematic(camera), cell = { instance: 'cinematic-cell', origin: { x: 0, z: 0 } };
  const feet = { x: 0, z: 0 };
  const frame = new GridFrame({ scope, host: { scene, camera, composer: () => composer,
    post: () => ({ saturation, contrast, grade }), cinematic: () => cinematic },
    cells: [cell], home: cell, homeIsFrame: false, half: 250, feet: () => feet });
  const release = frame.contribute(cell.instance, { chain });
  try {
    frame.frame(); frame.frame();
    expect(cinematic.state().grain).toBe(CINEMATIC_FX.grain);
    for (let visit = 0; visit < 4; visit++) {
      feet.x = 250.001; frame.frame();
      expect(cinematic.state().grain).toBe(0);
      expect(frame.state().weights[cell.instance]).toBeGreaterThan(0); // colour blend remains live on this road edge
      feet.x = 0; frame.frame();
      expect(cinematic.state().grain).toBe(CINEMATIC_FX.grain);
      expect(passEffects(pass)?.filter(effect => effect === cinematic.grain)).toHaveLength(1);
    }
    release(); frame.frame();
    expect(cinematic.state().grain).toBe(0);
  } finally { release(); scope.dispose(); pass.dispose(); }
});
