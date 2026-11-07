import { expect, test } from 'vitest';
import { HalfFloatType, Mesh, PerspectiveCamera, ShaderMaterial, Texture, UnsignedByteType, WebGLRenderTarget } from 'three';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import type { Renderer } from '@wildshard/engine/render/renderer';
import type { GraphIr } from '@wildshard/format/materialGraph';
import type { ScaledPostRow } from '@wildshard/format/scaledPost';
import { prepareScaledPost, ScaledPostPass } from './scaledPost';

function copy(): GraphIr {
  return { version: 1, kind: 'post', params: { source: { type: 'texture', role: 'lent', value: 'source' } },
    nodes: { uv: { op: 'screenUV' }, sample: { op: 'texture', param: 'source', in: ['uv'] }, rgb: { op: 'swizzle', in: ['sample'], mask: 'xyz' } }, stages: { post: { colour: 'rgb' } } };
}
function row(): ScaledPostRow {
  const graph = copy(), byte = { ...graph, params: { ...graph.params, byteOnly: { type: 'float', value: 1 } } } satisfies GraphIr;
  return { name: 'StoragePost', programs: { fused: { graph }, copy: { graph: byte, links: ['byteOnly'] }, grade: { graph } },
    targets: { line: { name: 'Storage.line', of: 'input', scale: 1, filter: 'nearest', storage: 'unorm8' }, frame: { name: 'Storage.frame', of: 'input', scale: 1, filter: 'nearest' } },
    draws: [{ program: 'fused', to: 'frame', textures: { source: 'input' }, storage: 'float16' }, { program: 'copy', to: 'line', textures: { source: 'input' }, storage: 'unorm8' }, { program: 'grade', to: 'frame', textures: { source: 'line' }, storage: 'unorm8' }],
    settings: {}, outputs: { final: 'frame', debugLine: 'line' } };
}
function singleTarget(value: unknown): value is WebGLRenderTarget { return value instanceof WebGLRenderTarget && value.texture instanceof Texture; }
async function host(float: boolean) {
  const draws: { name: string; target: WebGLRenderTarget | null }[] = [];
  let target: WebGLRenderTarget | null = null;
  const renderer = legacyDouble<Renderer>({ extensions: legacyDouble<Renderer['extensions']>({ has: () => float }),
    setRenderTarget: next => { if (next !== null && !(singleTarget(next))) throw new Error('Expected native target'); target = next; },
    render: scene => { scene.traverse(object => { if (object instanceof Mesh && object.material instanceof ShaderMaterial) draws.push({ name: object.material.name, target }); }); } });
  await prepareScaledPost(renderer);
  return { renderer, draws };
}

test('half targets select one native draw and leave the byte-only target and feeds inactive', async () => {
  const { renderer, draws } = await host(true), input = new WebGLRenderTarget(8, 16), pass = new ScaledPostPass(row(), { renderer, camera: new PerspectiveCamera() });
  try {
    pass.initialize(renderer, true, HalfFloatType); pass.setSize(8, 16); pass.render(renderer, input);
    expect(draws.map(draw => draw.name)).toEqual(['StoragePost.fused']);
    expect(draws[0]?.target?.texture.type).toBe(HalfFloatType);
    expect(pass.output('final')).toBe(draws[0]?.target?.texture); expect(pass.output('debugLine')).toBeNull();
  } finally { pass.dispose(); input.dispose(); }
});

test('byte or missing-float-capability paths retain both native targets, draws, source handoff and disposal', async () => {
  for (const floats of [true, false]) {
    const { renderer, draws } = await host(floats), input = new WebGLRenderTarget(8, 16), pass = new ScaledPostPass(row(), { renderer, camera: new PerspectiveCamera(), links: { byteOnly: { value: 1 } } });
    try {
      pass.initialize(renderer, true, floats ? UnsignedByteType : HalfFloatType); pass.setSize(8, 16); pass.render(renderer, input);
      expect(draws.map(draw => draw.name)).toEqual(['StoragePost.copy', 'StoragePost.grade']);
      expect(draws.map(draw => draw.target?.texture.type)).toEqual([UnsignedByteType, UnsignedByteType]);
      expect(pass.output('debugLine')).toBe(draws[0]?.target?.texture); expect(pass.output('final')).toBe(draws[1]?.target?.texture);
      const grade = pass.material('grade'); if (!(grade instanceof ShaderMaterial)) throw new Error('Missing native grade material');
      expect(grade.uniforms['wsT_source']?.value).toBe(draws[0]?.target?.texture);
      let disposed = 0; for (const draw of draws) draw.target?.addEventListener('dispose', () => { disposed++; });
      pass.setSize(4, 8); expect(disposed).toBe(2); draws.length = 0; pass.render(renderer, input);
      expect(draws.map(draw => [draw.target?.width, draw.target?.height])).toEqual([[4, 8], [4, 8]]);
    } finally { pass.dispose(); input.dispose(); }
  }
});

test('a changed composer target format rebuilds opted-in target ownership at the same size', async () => {
  const { renderer, draws } = await host(true), input = new WebGLRenderTarget(8, 16), pass = new ScaledPostPass(row(), { renderer, camera: new PerspectiveCamera(), links: { byteOnly: { value: 1 } } });
  try {
    pass.setSize(8, 16); pass.render(renderer, input); const old = draws[0]?.target;
    let disposed = false; old?.addEventListener('dispose', () => { disposed = true; });
    pass.initialize(renderer, true, UnsignedByteType); expect(disposed).toBe(true); draws.length = 0; pass.render(renderer, input);
    expect(draws.map(draw => draw.name)).toEqual(['StoragePost.copy', 'StoragePost.grade']);
    expect(draws.every(draw => draw.target?.texture.type === UnsignedByteType)).toBe(true);
    pass.initialize(renderer, true, HalfFloatType); draws.length = 0; pass.render(renderer, input);
    expect(draws.map(draw => draw.name)).toEqual(['StoragePost.fused']); expect(pass.output('debugLine')).toBeNull();
  } finally { pass.dispose(); input.dispose(); }
});

test('ordinary rows keep every draw and feed, including repeated programs and the composer output buffer', async () => {
  const { renderer, draws } = await host(true), graph = copy(), ordinary: ScaledPostRow = { name: 'Ordinary', programs: { copy: { graph } }, targets: { frame: { name: 'ordinary', of: 'input', scale: 1, filter: 'nearest' } }, draws: [{ program: 'copy', to: 'frame', textures: { source: 'input' } }, { program: 'copy', to: 'frame', textures: { source: 'input' } }], settings: {}, outputs: { final: 'frame' } };
  const pass = new ScaledPostPass(ordinary, { renderer, camera: new PerspectiveCamera(), buffer: 'final' }), input = new WebGLRenderTarget(8, 16), output = new WebGLRenderTarget(8, 16), depth = new Texture();
  try {
    pass.initialize(renderer, true, HalfFloatType); pass.setSize(8, 16); pass.setDepthTexture(depth); pass.render(renderer, input, output);
    expect(draws.map(draw => draw.name)).toEqual(['Ordinary.copy', 'Ordinary.copy']); expect(draws.every(draw => draw.target === output)).toBe(true); expect(pass.needsSwap).toBe(true);
  } finally { pass.dispose(); input.dispose(); output.dispose(); depth.dispose(); }
});

test('storage declarations refuse invalid tags and cross-format sources before allocating targets', async () => {
  const { renderer } = await host(true), ctx = { renderer, camera: new PerspectiveCamera() };
  const bad = row(); Reflect.set(bad.targets['line'] ?? {}, 'storage', 'other');
  expect(() => new ScaledPostPass(bad, ctx)).toThrow(/storage/);
  const source = row(), draw = source.draws[0]; if (draw === undefined) throw new Error('Missing fixture draw');
  expect(() => new ScaledPostPass({ ...source, draws: [{ ...draw, textures: { source: 'line' } }] }, ctx)).toThrow(/storage/);
  expect(() => new ScaledPostPass({ ...source, targets: { ...source.targets, next: { name: 'next', of: 'line', scale: 1, filter: 'nearest', storage: 'float16' } } }, ctx)).toThrow(/storage/);
});
