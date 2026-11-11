import { afterEach, expect, test } from 'vitest';
import { BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, UniformsLib, UniformsUtils, type IUniform, type Material, type ShaderMaterial } from 'three';
import { onFault, type Fault } from '../../../shared/engine/core/faults';
import { GraphShaderMaterial } from './graph/glslMaterial';
import { drawHooks } from './drawHooks';
import { LIGHT_UNIFORMS } from './lightUniforms';

// SENTRY-TRIAGE S2, WILDSHARD-GAME-84 (the fatal Sunscar Dunes render crash): three's getProgram points a lit material's
// light uniforms at the arrays of the render state it is drawn or compiled in (WebGLRenderer.getProgram:
// `uniforms.pointLights.value = lights.state.point`), and skips that on a later draw while its program and light-state
// version stand. Two materials sharing those holders hand each other their arrays.

interface LightState { readonly point: object[]; readonly spot: object[]; readonly directional: object[] }
const state = (point: number): LightState => ({ point: Array.from({ length: point }, () => ({ position: [0, 0, 0] })), spot: [], directional: [] });
/** what three's getProgram does to a lit material's uniforms for the state it binds to */
function bind(material: ShaderMaterial, lights: LightState): void {
  const u = material.uniforms;
  for (const [name, value] of [['pointLights', lights.point], ['spotLights', lights.spot], ['directionalLights', lights.directional]] as const) {
    const holder = u[name];
    if (holder === undefined) throw new Error(`no ${name} uniform`);
    holder.value = value;
  }
}
/** three's struct upload for a program built for `count` point lights: each entry's members, `position` first */
function upload(material: ShaderMaterial, count: number): void {
  const values: unknown = material.uniforms['pointLights']?.value;
  if (!Array.isArray(values)) throw new TypeError('no point light array');
  for (let i = 0; i < count; i++) {
    const light: unknown = values[i];
    if (typeof light !== 'object' || light === null) throw new TypeError("Cannot read properties of undefined (reading 'position')");
  }
}
const litUniforms = (): Record<string, IUniform> => ({ ...UniformsUtils.merge([UniformsLib.lights]), wsTint: { value: 1 } });

test('a graph material\'s copy has its own light uniforms and still shares the graph\'s', () => {
  const source = new GraphShaderMaterial({ uniforms: litUniforms(), lights: true, vertexShader: 'void main() { }', fragmentShader: 'void main() { }' });
  const copy = source.clone();
  for (const name of LIGHT_UNIFORMS) if (source.uniforms[name] !== undefined) expect(copy.uniforms[name]).not.toBe(source.uniforms[name]);
  expect(copy.uniforms['wsTint']).toBe(source.uniforms['wsTint']);
  const page = state(4);
  bind(source, page); bind(copy, state(1));
  expect(() => { upload(source, 4); }).not.toThrow();
});

const faults: Fault[] = [];
let off: (() => void) | undefined;
afterEach(() => { off?.(); off = undefined; faults.length = 0; });

interface Row { needsLights: boolean; lightsStateVersion: number; uniforms: Record<string, { value: unknown }>; currentProgram: { getUniforms: () => { map: Record<string, { seq: unknown[] }> } } }
/**
 * three's draw, cut to what the guard relies on (WebGLRenderer.setProgram/getProgram, WebGLState.useProgram): a stale
 * light-state version repoints the holders at the drawing state's arrays; only binding a program that is not current
 * uploads the light structs, entry by entry, as the program reads them.
 */
function threeLike(row: Row, page: object[], fault?: Error) {
  const program = {}, uploads: number[] = [];
  let current: object | null = program, version = 5, draws = 0;
  row.currentProgram = { getUniforms: () => ({ map: { pointLights: { seq: page.map(() => ({})) } } }) };
  const renderer = {
    state: { useProgram: (next: object | null) => { current = next; } },
    properties: { get: () => row },
    renderBufferDirect: () => {
      draws++;
      if (fault !== undefined) throw fault;
      if (row.lightsStateVersion !== version) { row.uniforms['pointLights'] = { value: page }; row.lightsStateVersion = version; }
      if (current === program) return;
      current = program;
      const held = row.uniforms['pointLights']?.value;
      if (!Array.isArray(held)) throw new TypeError('no light array');
      for (let i = 0; i < page.length; i++) if (held[i] === undefined) throw new TypeError("Cannot read properties of undefined (reading 'position')");
      uploads.push(page.length);
    },
  };
  return { renderer, uploads, draws: () => draws, setVersion: (next: number) => { version = next; } };
}
const drawWith = (renderer: { renderBufferDirect: (...args: unknown[]) => void }, material: Material): void => {
  renderer.renderBufferDirect(new PerspectiveCamera(), new Scene(), new BoxGeometry(), material, new Mesh(), null);
};
const lightsOf = (count: number): object[] => Array.from({ length: count }, () => ({ position: [0, 0, 0] }));

test('the draw guard rebinds a lit draw whose lights point at shorter arrays, uploads every light and reports it once', () => {
  off = onFault((fault) => { faults.push(fault); });
  const page = lightsOf(4);
  // the holder was repointed at the precompile's 1-light arrays while the version still reads current
  const row: Row = { needsLights: true, lightsStateVersion: 5, uniforms: { pointLights: { value: lightsOf(1) } }, currentProgram: { getUniforms: () => ({ map: {} }) } };
  const three = threeLike(row, page);
  three.renderer.state.useProgram(null); // a program switch before this draw: its upload runs and throws
  drawHooks(three.renderer);
  const material = new MeshBasicMaterial(); material.name = 'graph:material';
  expect(() => { drawWith(three.renderer, material); }).not.toThrow();
  expect(three.draws()).toBe(2);
  expect(row.uniforms['pointLights']?.value).toBe(page);
  expect(three.uploads).toEqual([4]);
  expect(faults).toHaveLength(1);
  expect(faults[0]?.system).toBe('render.lights');
  expect(faults[0]?.verdict).toBe('retry');
  expect(String(faults[0]?.error)).toContain('graph:material');
  expect(String(faults[0]?.error)).toContain('pointLights 1/4');
  // the same material faulting again is rebound again but not reported twice
  row.uniforms['pointLights'] = { value: lightsOf(2) }; three.renderer.state.useProgram(null);
  expect(() => { drawWith(three.renderer, material); }).not.toThrow();
  expect(three.uploads).toEqual([4, 4]);
  expect(faults).toHaveLength(1);
});

test('the draw guard rethrows anything but a short light array: an unlit draw, a lit TypeError with whole arrays, other errors', () => {
  off = onFault((fault) => { faults.push(fault); });
  const whole = (needsLights: boolean): Row => ({ needsLights, lightsStateVersion: 5, uniforms: { pointLights: { value: lightsOf(2) } }, currentProgram: { getUniforms: () => ({ map: {} }) } });
  const unlit = threeLike(whole(false), lightsOf(2), new TypeError('boom'));
  drawHooks(unlit.renderer);
  expect(() => { drawWith(unlit.renderer, new MeshBasicMaterial()); }).toThrow('boom');
  const lit = threeLike(whole(true), lightsOf(2), new TypeError('a bad custom uniform'));
  drawHooks(lit.renderer);
  expect(() => { drawWith(lit.renderer, new MeshBasicMaterial()); }).toThrow('a bad custom uniform');
  const short: Row = { ...whole(true), uniforms: { pointLights: { value: [] } } };
  const lost = threeLike(short, lightsOf(2), new RangeError('context lost'));
  drawHooks(lost.renderer);
  expect(() => { drawWith(lost.renderer, new MeshBasicMaterial()); }).toThrow('context lost');
  // a short array whose redraw still throws: the second error is the caller's
  const again = threeLike({ ...whole(true), uniforms: { pointLights: { value: [] } } }, lightsOf(2), new TypeError('still broken'));
  drawHooks(again.renderer);
  expect(() => { drawWith(again.renderer, new MeshBasicMaterial()); }).toThrow('still broken');
  expect(again.draws()).toBe(2);
  expect(lit.draws()).toBe(1);
});
