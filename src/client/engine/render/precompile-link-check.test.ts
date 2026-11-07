import { afterEach, expect, test, vi } from 'vitest';
import { reportLinkFailure } from './precompile';

afterEach(() => { vi.restoreAllMocks(); });

/** the GL calls a link check makes, over one program whose link either failed or succeeded */
function glWith(linked: boolean) {
  const program: WebGLProgram = {}, vertex: WebGLShader = {}, fragment: WebGLShader = {}, calls: string[] = [];
  const gl = {
    LINK_STATUS: 0x8b82 as const, VALIDATE_STATUS: 0x8b83 as const, SHADER_TYPE: 0x8b4f as const, VERTEX_SHADER: 0x8b31 as const,
    getProgramParameter: (_program: WebGLProgram, name: number): boolean => { calls.push(`param:${String(name)}`); return name === 0x8b82 ? linked : false; },
    getAttachedShaders: (): WebGLShader[] => { calls.push('shaders'); return [vertex, fragment]; },
    getShaderParameter: (shader: WebGLShader): number => (shader === vertex ? 0x8b31 : 0x8b30),
    getShaderInfoLog: (shader: WebGLShader): string => { calls.push('shader-log'); return shader === vertex ? '' : "ERROR: 0:12: 'wsMissing' : undeclared identifier"; },
    getProgramInfoLog: (): string => { calls.push('program-log'); return 'link failed'; },
    getError: (): number => 0,
  };
  return { gl, program, calls };
}

test('a broken shader still reports as three reports it once the renderer\'s own check is off (D176)', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { gl, program } = glWith(false);
  expect(reportLinkFailure(gl, { program, name: 'cabin-door', type: 'GraphLitMaterial' })).toBe(true);
  expect(error).toHaveBeenCalledTimes(1);
  const message = String(error.mock.calls[0]?.[0]);
  expect(message).toContain('THREE.WebGLProgram: Shader Error');
  expect(message).toContain('Material Name: cabin-door');
  expect(message).toContain('Program Info Log: link failed');
  expect(message).toContain("fragment shader log: ERROR: 0:12: 'wsMissing' : undeclared identifier");
});

test('a linked program costs one status read and no info logs', () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const { gl, program, calls } = glWith(true);
  expect(reportLinkFailure(gl, { program, name: 'deck', type: 'MeshStandardMaterial' })).toBe(false);
  expect(calls).toEqual([`param:${String(0x8b82)}`]);
  expect(error).not.toHaveBeenCalled();
});
