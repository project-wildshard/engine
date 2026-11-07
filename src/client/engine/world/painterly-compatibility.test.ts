import { expect, test } from 'vitest';
import * as v from 'valibot';
import { ShaderLib, WebGLRenderer, type WebGLProgramParametersWithUniforms } from 'three';
import { PainterlyMaterialSchema } from '@wildshard/format/materialFamilies';
import { painterlyKnobs, painterlyMaterial, painterlyUniforms } from './painterly';

test('the legacy bow retains its exact additive shade fill through the shared family', () => {
  // Frozen recurve viewmodels use 2.4 to add cool fill on the shade side.
  const material = painterlyMaterial(null, { rim: 0.55, bands: 0.7, shade: 2.4 });
  try {
    const knobs = painterlyKnobs(material);
    expect(knobs?.uPShadeAmt.value).toBe(2.4);
    expect(knobs?.uPRim.value).toBe(0.55);
    expect(knobs?.uPBands.value).toBe(0.7);
    // Compatibility does not widen authored material admission.
    expect(() => v.parse(PainterlyMaterialSchema, { family: 'painterly', shade: 2.4 })).toThrow();
  } finally { material.dispose(); }
});

test('legacy shade remains finite and nonnegative while the default stays one', () => {
  for (const shade of [-1, Number.NaN, Infinity, -Infinity]) {
    expect(() => painterlyMaterial(null, { shade })).toThrow();
  }
  for (const shade of [undefined, 0, 0.5, 1]) {
    const material = painterlyMaterial(null, shade === undefined ? {} : { shade });
    try { expect(painterlyKnobs(material)?.uPShadeAmt.value).toBe(shade ?? 1); }
    finally { material.dispose(); }
  }
});


test('legacy terrain and creature patches borrow the original declared live uniforms', () => {
  const material = painterlyMaterial(null);
  const shader: object = { vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader, uniforms: {} };
  const renderer: unknown = Object.create(WebGLRenderer.prototype);
  const isProgram = (value: object): value is WebGLProgramParametersWithUniforms => 'vertexShader' in value && 'fragmentShader' in value && 'uniforms' in value;
  if (!isProgram(shader) || !(renderer instanceof WebGLRenderer)) throw new Error('Missing compile fixture');
  try {
    material.onBeforeCompile(shader, renderer);
    expect(shader.fragmentShader.match(/uniform vec3 uPSunDir;/gu)).toHaveLength(1);
    expect(shader.uniforms['uPSunDir']).toBe(painterlyUniforms.uPSunDir);
    expect(shader.vertexShader.match(/uniform float uPTime;/gu)).toHaveLength(1);
    expect(shader.uniforms['uPTime']).toBe(painterlyUniforms.uPTime);
  } finally { material.dispose(); }
});
