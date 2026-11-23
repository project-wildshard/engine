// DF8 (meta DRIFTWOOD-FPS, mini-dwfps2): the client build's three transform keys shadow depth and unlit programs without
// the side and normals their shaders never read (vite/threeSideBlindPrograms.ts), behind `debug.programTwins`.
import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Read the installed three build the client transform rewrites.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the installed three build.
import { createRequire } from 'node:module';
import { SIDE_BLIND_EDIT, sideBlindPrograms } from '../vite/threeSideBlindPrograms';
import { programTwins, PROGRAM_TWINS_DEFAULT, PROGRAM_TWINS_PHONE_LOW } from '../src/client/engine/render/programTwins';

const build = createRequire(import.meta.url).resolve('three').replace(/three\.(?:cjs|module\.js)$/u, 'three.module.js');
const source = readFileSync(build, 'utf8');

test('DF8: the edit lands once, at the end of getParameters, and leaves other files alone', () => {
  const patched = sideBlindPrograms(source, build) ?? '';
  const start = patched.indexOf('function getParameters('), end = patched.indexOf('function getProgramCacheKey(', start);
  const body = patched.slice(start, end);
  expect(body).toContain('renderer.wsSideBlindPrograms === true');
  expect(body.indexOf('parameters.vertexNormals = false')).toBeLessThan(body.lastIndexOf('return parameters;'));
  expect(sideBlindPrograms(source, '/x/three/src/Three.js')).toBeNull();
  expect(() => sideBlindPrograms(source.replace(SIDE_BLIND_EDIT[0], ''), build)).toThrow(/update vite/);
});

/** the inserted condition, run on a material and the parameters three computed for it */
function fold(material: object, parameters: Record<string, unknown>, on = true): Record<string, unknown> {
  const condition = SIDE_BLIND_EDIT[1].slice(SIDE_BLIND_EDIT[1].indexOf('if ('), SIDE_BLIND_EDIT[1].indexOf('return parameters;'));
  // eslint-disable-next-line @typescript-eslint/no-implied-eval -- the condition under test is the transform's own text
  new Function('renderer', 'material', 'parameters', condition)({ wsSideBlindPrograms: on }, material, parameters);
  return parameters;
}

test('DF8: depth without displacement and basic without an environment map lose side and normals; others keep them', () => {
  const sided = () => ({ doubleSided: false, flipSided: true, vertexNormals: true, displacementMap: false, envMap: false });
  expect(fold({ isMeshDepthMaterial: true }, sided())).toMatchObject({ flipSided: false, vertexNormals: false });
  expect(fold({ isMeshBasicMaterial: true }, sided())).toMatchObject({ flipSided: false, vertexNormals: false });
  expect(fold({ isMeshDepthMaterial: true }, { ...sided(), displacementMap: true })).toMatchObject({ flipSided: true, vertexNormals: true });
  expect(fold({ isMeshBasicMaterial: true }, { ...sided(), envMap: true })).toMatchObject({ flipSided: true, vertexNormals: true });
  expect(fold({ isMeshStandardMaterial: true }, sided())).toMatchObject({ flipSided: true, vertexNormals: true });
  expect(fold({ isMeshDepthMaterial: true }, sided(), false)).toMatchObject({ flipSided: true, vertexNormals: true });
});

test('DF8: the slot is off by default and on at phone Low unless a saved pick says otherwise', () => {
  expect(programTwins(null)).toBe(PROGRAM_TWINS_DEFAULT);
  expect(programTwins(null, true)).toBe(PROGRAM_TWINS_PHONE_LOW);
  expect(programTwins(false, true)).toBe(false);
  expect(programTwins('on')).toBe(true);
});
