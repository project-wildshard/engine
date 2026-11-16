/** LS8 (J204): a shaders step slower than this per program it built marks a GPU that builds pipelines on the CPU, whose first
 *  frame starts with narrow slices (Game FIRST_DRAW_NARROW). Measured on Driftwood at 4x CPU, 2026-11-09: SwiftShader 34 ms,
 *  this Mac's Metal GPU 7 ms, WebKit 2.4 ms a program. */
export const SLOW_SHADER_MS_PER_PROGRAM = 15;

/** Whether the boot shaders step measured a GPU that builds its pipelines on the CPU. STAGING-BUGBASH SB32b: only the step's
 *  program builds count, never its texture uploads (precompile's 'upload' stage), which are paced by painted frames and
 *  grow with the level's textures, not with the GPU: Pine's 2417 ms step for 63 programs on a Metal GPU was mostly
 *  uploads, and read as 38 ms a program. */
export function slowShaderGpu({ stepMs, uploadMs, programs }: { readonly stepMs: number; readonly uploadMs: number; readonly programs: number }): boolean {
  return programs > 0 && Math.max(0, stepMs - uploadMs) / programs > SLOW_SHADER_MS_PER_PROGRAM;
}
