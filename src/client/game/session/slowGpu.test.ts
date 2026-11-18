// STAGING-BUGBASH SB32b (opus-pineload): the shaders step's texture uploads are not program builds. Pine's step on this
// Mac's Metal GPU was 2417 ms for 63 programs, almost all of it compressed uploads paced a painted frame apiece, so it
// read as 38 ms a program and Pine booted as a software GPU: a narrowed first frame and paced frames in play.
import { expect, test } from 'vitest';
import { SLOW_SHADER_MS_PER_PROGRAM, slowShaderGpu } from './slowGpu';

const SWIFTSHADER = 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (LLVM 10.0.0) (0x0000C0DE)), SwiftShader driver)';

test('a step slow only in its texture uploads is a real GPU', () => {
  expect(slowShaderGpu({ stepMs: 2417, uploadMs: 2100, programs: 63, renderer: SWIFTSHADER })).toBe(false);
});

test('a step slow in its program builds is still a software GPU (SwiftShader, 34 ms a program)', () => {
  expect(slowShaderGpu({ stepMs: 57 * 34 + 400, uploadMs: 400, programs: 57, renderer: SWIFTSHADER })).toBe(true);
});

test('a step that built nothing never marks the GPU slow', () => {
  expect(slowShaderGpu({ stepMs: 5000, uploadMs: 0, programs: 0, renderer: SWIFTSHADER })).toBe(false);
});

test('the bar is LS8 (J204): 15 ms a program', () => {
  expect(SLOW_SHADER_MS_PER_PROGRAM).toBe(15);
});

/** STAGING-BUGBASH SB47 (opus-sb49): Jake's Low Power iPhone built Driftwood's 58 programs in an 11.4 s shaders step (Metal,
 *  ~190 ms a program), so it booted as a software GPU: a first frame of 246 one-drawable slices, each a painted frame at
 *  30 Hz (First frame 8.0 s), and a covered canvas. Headless WebKit at 4x CPU sat on the bar (916 ms: wide, First frame
 *  1.5 s; 963 ms: narrow, 6.7 s). A real GPU builds its pipelines in its own process: only a software rasterizer is slow. */
test('a real GPU slow in its program builds is never a software GPU (Jake\'s iPhone, headless WebKit at 4x)', () => {
  expect(slowShaderGpu({ stepMs: 11_400, uploadMs: 300, programs: 58, renderer: 'Apple GPU' })).toBe(false);
  expect(slowShaderGpu({ stepMs: 963, uploadMs: 82, programs: 58, renderer: 'Apple GPU' })).toBe(false);
  expect(slowShaderGpu({ stepMs: 963, uploadMs: 82, programs: 58, renderer: SWIFTSHADER })).toBe(true);
});
