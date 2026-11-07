import type { LookGraphCompiler, LookGraphFog } from '../../src/client/engine/render/graphBackend';
import { attachClassicOutline, compileClassicGraph } from '../../src/client/engine/render/graph/glslMaterial';
import type { ClassicFog } from '../../src/client/engine/render/graph/glslProgram';

/**
 * The shipped classic GLSL look compiler behind the look-material contract, as `loadLookGraphCompiler` makes it, without a
 * renderer: tests hand it to `clientGraphs` in place of the retired TSL compiler (NF18). Its declared fogs are tokens
 * that only this compiler resolves, as the engine's are.
 */
export function classicLookCompiler(): LookGraphCompiler {
  const fogs = new WeakMap<LookGraphFog, ClassicFog>();
  return {
    backend: 'glsl',
    compileGraph: (input, { fog, ...opts }) => {
      const unwrap = (id: string): ClassicFog => {
        const token = fog?.(id), own = token === undefined ? undefined : fogs.get(token);
        if (own === undefined) throw new Error('material graph: a declared fog of another compile');
        return own;
      };
      const compiled = compileClassicGraph(input, { ...opts, ...(fog === undefined ? {} : { fog: unwrap }) });
      let token: LookGraphFog | null = null;
      if (compiled.fog !== null) { token = { backend: 'glsl' }; fogs.set(token, compiled.fog); }
      return { material: compiled.material, outline: compiled.outline, fog: token, bindings: compiled.bindings, setParam: compiled.setParam, setTexture: compiled.setTexture };
    },
    attachOutline: attachClassicOutline,
  };
}
