import { Scope } from '../../../shared/engine/app/scope';
import { diagnosticNow } from '../../../shared/engine/core/clock';

/** X7 fixed offscreen fill workload. A readback fences Metal/ANGLE, where finish alone can return early. */
export interface TierBenchmark { score: number; passes: number; seconds: number; renderer: string; width: number; height: number }
export async function benchmarkTierGpu(gl: WebGL2RenderingContext, durationMs = 2000): Promise<TierBenchmark> {
  const scope = new Scope('tier.benchmark');
  const width = 1280, height = 720;
  const shader = (type: number, source: string): WebGLShader => {
    const result = gl.createShader(type); if (!result) throw new Error('Tier benchmark shader allocation');
    gl.shaderSource(result, source); gl.compileShader(result);
    if (gl.getShaderParameter(result, gl.COMPILE_STATUS) !== true) { const log = gl.getShaderInfoLog(result); gl.deleteShader(result); throw new Error(`Tier benchmark compile: ${log ?? ''}`); }
    return result;
  };
  const vertex = shader(gl.VERTEX_SHADER, `#version 300 es
    void main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2. - 1., 0., 1.); }`);
  const fragment = shader(gl.FRAGMENT_SHADER, `#version 300 es
    precision highp float; uniform float seed; out vec4 color;
    void main() { vec3 v = vec3(gl_FragCoord.xy / vec2(1280.,720.), seed);
      for (int i = 0; i < 32; i++) v = fract(v.yzx * vec3(1.17,1.31,1.53) + dot(v,v) * .137);
      color = vec4(v,1.); }`);
  const program = gl.createProgram(), target = gl.createFramebuffer(), buffer = gl.createRenderbuffer(), vao = gl.createVertexArray();
  if (gl.isContextLost()) { gl.deleteShader(vertex); gl.deleteShader(fragment); gl.deleteProgram(program); gl.deleteFramebuffer(target); gl.deleteRenderbuffer(buffer); gl.deleteVertexArray(vao); throw new Error('Tier benchmark allocation'); }
  try {
    gl.attachShader(program, vertex); gl.attachShader(program, fragment); gl.linkProgram(program);
    if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) throw new Error('Tier benchmark link');
    gl.bindRenderbuffer(gl.RENDERBUFFER, buffer); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, width, height);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target); gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, buffer);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Tier benchmark target');
    gl.bindVertexArray(vao); gl.useProgram(program); gl.viewport(0, 0, width, height); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    const seed = gl.getUniformLocation(program, 'seed'), pixel = new Uint8Array(4);
    const draw = (n: number): void => { gl.uniform1f(seed, n * 0.0001); gl.drawArrays(gl.TRIANGLES, 0, 3); };
    const sync = (): void => { gl.finish(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); };
    draw(0); sync(); // link and first-use cost excluded
    const start = diagnosticNow(); let passes = 0;
    do {
      for (let i = 0; i < 8; i++) draw(passes++);
      sync();
      await new Promise<void>((resolve) => { scope.timeout(0, resolve); }); // loading UI remains responsive
    } while (diagnosticNow() - start < durationMs && !gl.isContextLost());
    if (gl.isContextLost()) throw new Error('Tier benchmark context lost');
    const seconds = (diagnosticNow() - start) / 1000;
    return { score: passes / seconds, passes, seconds, width, height, renderer: gpuRenderer(gl) };
  } finally {
    scope.dispose();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.bindRenderbuffer(gl.RENDERBUFFER, null); gl.bindVertexArray(null); gl.useProgram(null);
    gl.deleteFramebuffer(target); gl.deleteRenderbuffer(buffer); gl.deleteVertexArray(vao); gl.deleteProgram(program); gl.deleteShader(vertex); gl.deleteShader(fragment);
  }
}
export function gpuRenderer(gl: WebGL2RenderingContext): string {
  const extension: { UNMASKED_RENDERER_WEBGL: number } | null = gl.getExtension('WEBGL_debug_renderer_info');
  const value: unknown = gl.getParameter(extension?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER);
  return typeof value === 'string' ? value : '';
}
