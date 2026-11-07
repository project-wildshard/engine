// oxlint-disable-next-line import/no-nodejs-modules -- Node's own SHA-256 is the oracle for the streamed browser hash.
import { createHash } from 'node:crypto';
import { expect, test } from 'vitest';
import { compiledProgramHash, programHash } from '../src/client/engine/debug/probe';

const sha = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

test('the streamed program hash is SHA-256 at every padding boundary and over multi-byte text', () => {
  for (const n of [0, 1, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000, 70_000]) expect(programHash('x'.repeat(n)), `${n}`).toBe(sha('x'.repeat(n)));
  const glsl = 'void main() { gl_FragColor = vec4(1.0); } // ünïcødé ✓ 🌙\n'.repeat(97);
  expect(programHash(glsl)).toBe(sha(glsl));
  // Lone surrogates encode as U+FFFD, as TextEncoder and Node's utf8 both write them.
  for (const odd of ['a\uD800b', '\uDC00', 'x\uD83D', '\uD83D\uDE00\uD83D', '\u07DF\u07FF\u0800\uFFFF']) expect(programHash(odd), JSON.stringify(odd)).toBe(sha(odd));
});

test('the compiled program hash is SHA-256 of the sorted sources joined by newlines', () => {
  const programs = [{ vertexShader: 'v2', fragmentShader: 'f2' }, { vertexShader: 'v1', fragmentShader: 'f1 ✓'.repeat(40) }];
  const joined = programs.map((p) => JSON.stringify([p.vertexShader, p.fragmentShader])).sort().join('\n');
  expect(compiledProgramHash(programs, (shader) => shader)).toBe(sha(joined));
  expect(() => compiledProgramHash(programs, () => null)).toThrow('Compiled program source unavailable');
});
