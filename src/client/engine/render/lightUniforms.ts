import { UniformsLib, type IUniform } from 'three';

/**
 * three's light uniforms (SENTRY-TRIAGE S2, `WILDSHARD-GAME-84`). three's `getProgram` points each one at the arrays of
 * the render state the material is drawn or compiled in (`uniforms.pointLights.value = lights.state.point`), and skips
 * that step on a later draw while the material's program and light-state version are unchanged. So two materials that
 * share one of these holders (a cell clip variant and its source, a graph material's copy) hand each other their arrays:
 * the precompile links a variant against its own scene of copied lights, the source's next page draw early-outs and
 * uploads the precompile's arrays to a program built for the page's light count. With fewer lights there, three reads
 * `undefined.position` inside the struct upload and the frame loop dies (the fatal Sunscar Dunes render crash).
 */
export const LIGHT_UNIFORMS: ReadonlySet<string> = new Set(Object.keys(UniformsLib.lights));

/** Give `uniforms` its own holder for each light uniform (the values stay: three repoints them on the next program
 *  bind). Every other uniform is left shared. Returns `uniforms`. */
export function ownLightUniforms<T extends Record<string, IUniform>>(uniforms: T): T {
  for (const name of LIGHT_UNIFORMS) {
    const shared = uniforms[name];
    if (shared !== undefined) Reflect.set(uniforms, name, { value: shared.value });
  }
  return uniforms;
}
