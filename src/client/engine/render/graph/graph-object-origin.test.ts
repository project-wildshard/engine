import { expect, test } from 'vitest';
import { compileClassicGraph } from './glslMaterial';

/** the source with every `#ifdef USE_INSTANCING … #endif` block removed: what a draw that is not instanced compiles */
const notInstanced = (source: string): string => source.replaceAll(/#ifdef USE_INSTANCING\n[^#]*#endif\n/gu, '');

test('object origins read the live placement attribute without a stale companion buffer', () => {
  const compiled = compileClassicGraph({ version: 1, kind: 'material', model: 'unlit',
    nodes: { origin: { op: 'objectOrigin' }, carried: { op: 'varying', in: ['origin'] } }, stages: { surface: { colour: 'carried' } }, effectState: { fog: false } });
  try {
    const { vertexShader, fragmentShader } = compiled.material;
    expect(compiled.material.positionGridCompatible).toBe(false);
    const main = vertexShader.slice(vertexShader.indexOf('void main()'));
    // the origin is the instance matrix's translation, read from three's live instanceMatrix attribute, carried by a varying
    // OF-EM28b3: less the grid origin on a grid-quantized mesh (step 1, origin 0 elsewhere), so it decodes with the codec
    expect(main).toMatch(/modelMatrix \* vec4\(wsInstanceTransform\(vec4\(0\.0, 0\.0, 0\.0, 1\.0\)\)\.xyz - wsCodecOrigin \/ wsCodecStep, 1\.0\)/u);
    expect(compiled.material.codec).not.toBeNull();
    expect(vertexShader).toMatch(/#ifdef USE_INSTANCING\n {2}v = instanceMatrix \* v;\n#endif/u);
    expect(vertexShader).toMatch(/varying vec3 wsV\d+_carried;/u);
    expect(fragmentShader).toMatch(/varying vec3 wsV\d+_carried;/u);
    expect(fragmentShader).not.toContain('instanceMatrix');
    expect(notInstanced(vertexShader)).not.toContain('instanceMatrix');
  } finally { compiled.material.dispose(); }
});
