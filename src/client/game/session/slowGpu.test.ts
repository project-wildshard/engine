// STAGING-BUGBASH SB32b (opus-pineload): the shaders step's texture uploads are not program builds. Pine's step on this
// Mac's Metal GPU was 2417 ms for 63 programs, almost all of it compressed uploads paced a painted frame apiece, so it
// read as 38 ms a program and Pine booted as a software GPU: a narrowed first frame and paced frames in play.
import { expect, test } from 'vitest';
import { SLOW_SHADER_MS_PER_PROGRAM, slowShaderGpu } from './slowGpu';

test('a step slow only in its texture uploads is a real GPU', () => {
  expect(slowShaderGpu({ stepMs: 2417, uploadMs: 2100, programs: 63 })).toBe(false);
});

test('a step slow in its program builds is still a software GPU (SwiftShader, 34 ms a program)', () => {
  expect(slowShaderGpu({ stepMs: 57 * 34 + 400, uploadMs: 400, programs: 57 })).toBe(true);
});

test('a step that built nothing never marks the GPU slow', () => {
  expect(slowShaderGpu({ stepMs: 5000, uploadMs: 0, programs: 0 })).toBe(false);
});

test('the bar is LS8 (J204): 15 ms a program', () => {
  expect(SLOW_SHADER_MS_PER_PROGRAM).toBe(15);
});
