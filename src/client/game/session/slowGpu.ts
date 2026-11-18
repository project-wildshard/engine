import { softwareRasterizer } from '@wildshard/engine/core/slowGpuPacing';
/** LS8 (J204): a shaders step slower than this per program it built marks a GPU that builds pipelines on the CPU, whose first
 *  frame starts with narrow slices (Game FIRST_DRAW_NARROW). Measured on Driftwood at 4x CPU, 2026-11-09: SwiftShader 34 ms,
 *  this Mac's Metal GPU 7 ms, WebKit 2.4 ms a program. */
export const SLOW_SHADER_MS_PER_PROGRAM = 15;

/** Whether the boot shaders step measured a GPU that builds its pipelines on the CPU. STAGING-BUGBASH SB32b: only the step's
 *  program builds count, never its texture uploads (precompile's 'upload' stage), which are paced by painted frames and
 *  grow with the level's textures, not with the GPU: Pine's 2417 ms step for 63 programs on a Metal GPU was mostly
 *  uploads, and read as 38 ms a program. */
export function slowShaderGpu({ stepMs, uploadMs, programs, renderer }: { readonly stepMs: number; readonly uploadMs: number; readonly programs: number;
  /** the WebGL renderer name (`webglRendererName`) */
  readonly renderer: string }): boolean {
  // SB47: a real GPU builds its programs in its own process, however slow (Jake's Low Power iPhone, ~190 ms a program on
  // Metal), and a narrowed first frame only spent a painted frame per drawable there (246 at 30 Hz: 8.0 s). RT3's rule:
  // only a software rasterizer is a slow GPU; a real one keeps the wide first frame, which still narrows after a slow slice.
  return softwareRasterizer(renderer) && programs > 0 && Math.max(0, stepMs - uploadMs) / programs > SLOW_SHADER_MS_PER_PROGRAM;
}
