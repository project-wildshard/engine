import { expect, test } from 'vitest';
import { BoxGeometry, Group, Mesh, ShaderMaterial, UniformsLib, UniformsUtils, type IUniform } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { cellClip } from './cellClip';

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

test('a cell clip variant has its own light uniforms: a precompile of it never rebinds its source\'s lights', () => {
  const scope = new Scope('clip lights'), root = new Group();
  try {
    const source = new ShaderMaterial({ uniforms: litUniforms(), lights: true, vertexShader: 'void main() { }', fragmentShader: 'void main() { }' });
    const guard = cellClip(root, 250, scope); guard.sweep();
    const crossing = new Mesh(new BoxGeometry(2, 40, 2), source); crossing.position.x = 250; root.add(crossing);
    const variant = crossing.material;
    if (!(variant instanceof ShaderMaterial) || variant === source) throw new Error('no clip variant');
    // the page draws the source with its 3 point lights; the precompile links the variant against 2 copied lights
    const page = state(3), compile = state(2);
    bind(source, page); bind(variant, compile);
    // the source's next page draw early-outs (same program, same version) and uploads what its holders point at
    expect(() => { upload(source, 3); }).not.toThrow();
    expect(source.uniforms['pointLights']?.value).toBe(page.point);
    // every other uniform is still the source's own cell (animated values stay borrowed)
    expect(variant.uniforms['wsTint']).toBe(source.uniforms['wsTint']);
  } finally { scope.dispose(); }
});
