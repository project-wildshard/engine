import { expect, test } from 'vitest';
import { compileClassicGraph } from './glslMaterial';
import { validateGraph, type GraphIr } from '@wildshard/format/materialGraph';

// a shard's declared fog (O11): its colour × 0.5 + the engine's half, with a marker param
const FOG: GraphIr = { version: 1, kind: 'fog', params: { mark: { type: 'float', value: 0.4375 } },
  nodes: { i: { op: 'fogInput' }, e: { op: 'engineFogged' }, s: { op: 'fogScale' }, p: { op: 'positionWorld' }, c: { op: 'cameraPosition' },
    d: { op: 'length', in: ['p'] }, m: { op: 'param', param: 'mark' },
    // a loop body builds with the program: its fog inputs must still resolve
    k: { op: 'loop', in: [0], count: 2, body: { nodes: { a: { op: 'acc' }, h: { op: 'mul', in: ['m', 's'] }, b: { op: 'add', in: ['a', 'h'] } }, out: 'b' } }, mx: { op: 'mix', in: ['i', 'e', 'k'] }, o: { op: 'add', in: ['mx', 'd'] } },
  stages: { fog: { colour: 'o' } } };
const SURFACE: GraphIr = { version: 1, kind: 'material', model: 'unlit', effectState: { fog: 'shard-fog' },
  nodes: { c: { op: 'const', value: [0.2, 0.3, 0.4] } }, stages: { surface: { colour: 'c' } } };

test('a material selecting a declared fog graph is fogged by it in the epilogue, sharing its params', () => {
  const fog = compileClassicGraph(FOG);
  expect(fog.fog).not.toBeNull();
  expect(fog.material.visible).toBe(false);
  const patch = fog.fog;
  if (patch === null) throw new Error('fog graph without a patch');
  expect(patch.glsl.fog).toMatch(/vec3 wsGraphFog\(/u);
  const asked: string[] = [];
  const material = compileClassicGraph(SURFACE, { fog: (id) => { asked.push(id); return patch; } });
  try {
    expect(asked).toEqual(['shard-fog']);
    expect(material.material.fog).toBe(true);
    const fragment = material.material.fragmentShader;
    expect(fragment).toContain('wsGraphFog(');
    // the fog runs in the epilogue: after the surface output, in place of three's fog chunk
    const main = fragment.slice(fragment.indexOf('void main()'));
    expect(main.indexOf('wsGraphFog(')).toBeGreaterThan(main.indexOf('diffuseColor'));
    const mark = Object.values(material.material.uniforms).find(value => value.value === 0.4375);
    if (mark === undefined) throw new Error('the fog graph param did not reach the selecting program');
    fog.setParam('mark', 0.25);
    expect(mark.value).toBe(0.25);
  } finally { material.material.dispose(); fog.material.dispose(); }
  expect(() => compileClassicGraph(SURFACE)).toThrow(/fog resolver/u);
});

test('fog graphs validate apart: fog inputs only in a fog stage, a fog stage only in a fog graph, a selection by id', () => {
  expect(validateGraph(FOG).ok).toBe(true);
  expect(validateGraph(SURFACE).ok).toBe(true);
  const misplaced = validateGraph({ ...SURFACE, nodes: { c: { op: 'fogInput' } } });
  expect(misplaced.ok).toBe(false);
  expect(validateGraph({ ...SURFACE, stages: { surface: { colour: 'c' }, fog: { colour: 'c' } } }).ok).toBe(false);
  expect(validateGraph({ ...FOG, model: 'unlit' }).ok).toBe(false);
  expect(validateGraph({ ...SURFACE, effectState: { fog: 'Not An Id' } }).ok).toBe(false);
  expect(validateGraph({ ...SURFACE, effectState: { fog: true } }).ok).toBe(false);
});
